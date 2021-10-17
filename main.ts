import { ethers } from "ethers";

type State = {
    fromContract: true | undefined,
    fromQueryFilter: true | undefined,
    received: number
}
const state = new Map<string, State>();
const label = "SYNC-EVENT";

function onSyncEventFromContract(reserve0: ethers.BigNumber, reserve1: ethers.BigNumber): void {
    const key = `${reserve0},${reserve1}`;
    console.log("fromContract   ", key);
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
        console.log("fromQueryFilter", key);
        const value = state.get(key);
        state.set(key, {
            fromContract: value?.fromContract,
            fromQueryFilter: true, // <-- mark event as "received via contact.queryFilter(...)"
            received: Date.now()
        })  
    }
}

function lookForMissingEventsFromContract() {
    const tenSeconds = 10000;
    for (const [key, value] of state.entries()) {
        const now = Date.now();
        if (value.fromContract && value.fromQueryFilter) {
            // event was received via contract.on(...) and contract.queryFilter(...)
            // i.e. everything is just fine :)
            continue;
        } else if (value.received < now - tenSeconds) {
            console.timeLog(label, "this is NOT fine", key, value)
        } else {
            // let's wait for the timeout
        }
    }
}

function main() {
    console.log("started at", new Date().toISOString())
    console.time(label);
    const url = "https://bsc-dataseed.binance.org/";
    const provider = new ethers.providers.JsonRpcProvider(url);
    const contract = new ethers.Contract("0x8fa59693458289914db0097f5f366d771b7a7c3f", [
        "event Sync(uint112 reserve0, uint112 reserve1)"
    ], provider)

    // eventually, this will skip "Sync" events
    contract.on("Sync", onSyncEventFromContract);

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
}
main();
