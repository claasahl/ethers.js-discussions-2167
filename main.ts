import { ethers } from "ethers";

type State = {
    fromContract: true | undefined,
    fromQueryFilter: true | undefined,
    received: number
}
const state = new Map<string, State>();
const label = "SYNC-EVENT";

function onSyncEventFromContract(reserve0: ethers.BigNumber, reserve1: ethers.BigNumber, event: ethers.Event): void {
    const key = `${reserve0},${reserve1}`;
    console.log("fromContract   ", key, event.blockNumber);
    const value = state.get(key);
    state.set(key, {
        fromContract: true, // <-- mark event as "received via contract.on(...)"
        fromQueryFilter: value?.fromQueryFilter,
        received: Date.now()
    })
}

function onSyncEventsFromQueryFilter(events: ethers.Event[]): void {
    for (const event of events) {
        const key = `${event.args?.reserve0},${event.args?.reserve1}`;
        console.log("fromQueryFilter", key, event.blockNumber);
        const value = state.get(key);
        state.set(key, {
            fromContract: value?.fromContract,
            fromQueryFilter: true, // <-- mark event as "received via contact.queryFilter(...)"
            received: Date.now()
        })
    }
}

function onErrorFromContract(error: Error, event: ethers.Event): void {
    console.log("fromContract >> error:", error, event)
}

function lookForMissingEventsFromContract() {
    const oneMinute = 60000;
    for (const [key, value] of state.entries()) {
        const now = Date.now();
        if (now - oneMinute < value.received) {
            // let's wait for the timeout
        } else if (value.fromContract && value.fromQueryFilter) {
            // event was received via contract.on(...) and contract.queryFilter(...)
            // i.e. everything is just fine :)
            state.delete(key); // <-- trying to keep the state/cache as small as possible
            continue;
        } else {
            console.timeLog(label, "found missing event", key, value);
            process.exit(1);
        }
    }
}

function main() {
    const pollingInterval = 8000;
    console.log(`pollingInterval=${pollingInterval}`);
    console.log("started at", new Date().toISOString());
    console.time(label);
    const url = "https://bsc-dataseed.binance.org/";
    const provider = new ethers.providers.JsonRpcProvider(url);
    provider.pollingInterval = pollingInterval;
    const contract = new ethers.Contract("0x8fa59693458289914db0097f5f366d771b7a7c3f", [
        "event Sync(uint112 reserve0, uint112 reserve1)"
    ], provider)

    // eventually, this will skip "Sync" events
    contract.on("Sync", onSyncEventFromContract);
    contract.on("error", onErrorFromContract);

    // poll "Sync" events for reference
    const filter = contract.filters["Sync"]();
    provider.on("block", blockNumber => {
        console.log("new block", blockNumber);
        lookForMissingEventsFromContract(); // <-- use "block"-events as the driving force to (re-)check for missing events
        setImmediate(async () => {
            const events = await contract.queryFilter(filter, blockNumber);
            onSyncEventsFromQueryFilter(events);
        })
    })
    provider.on("poll", (pollId, blockNumber) => console.log(`polling ${pollId} (${blockNumber})`));
    provider.on("didPoll", pollId => console.log(`polled  ${pollId}`));
}
main();
