import { ethers } from "ethers";

type State = {
    fromContract: true | undefined,
    fromQueryFilter: true | undefined,
    fromLogs: true | undefined,
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
        fromLogs: value?.fromLogs,
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
            fromLogs: value?.fromLogs,
            received: Date.now()
        })  
    }
}

function onSyncEventsFromLogs(logs: ethers.providers.Log[]): void {
    const abi = new ethers.utils.AbiCoder();
    for (const log of logs) {
        const [reserve0, reserve1] = abi.decode(["uint112", "uint112"], log.data);
        const key = `${reserve0},${reserve1}`;
        console.log("fromLogs", key);
        const value = state.get(key);
        state.set(key, {
            fromContract: value?.fromContract,
            fromQueryFilter:  value?.fromQueryFilter,
            fromLogs: true, // <-- mark event as "received via provider.getLogs(...)"
            received: Date.now()
        })  
    }
}

function lookForMissingEventsFromContract() {
    const oneMinute = 60000;
    for (const [key, value] of state.entries()) {
        const now = Date.now();
        if (now - oneMinute < value.received) {
            // let's wait for the timeout
        } else if (value.fromContract && value.fromQueryFilter && value.fromLogs) {
            // event was received via contract.on(...), contract.queryFilter(...)
            // and provider.getLogs(...). I.e. everything is just fine :)
            state.delete(key); // <-- trying to keep the state/cache as small as possible
            continue;
        } else {
            console.timeLog(label, "found missing event", key, value);
            process.exit(1);
        }
    }
}

function main() {
    const pollingInterval = 4000;
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

    // poll "Sync" events for reference
    const filter = contract.filters["Sync"]();
    provider.on("block", blockNumber => {
        console.log("new block", blockNumber);
        lookForMissingEventsFromContract(); // <-- use "block"-events as the driving force to (re-)check for missing events
        setImmediate(async () => {
            const logs = await provider.getLogs({
                ...filter,
                fromBlock: blockNumber,
                toBlock: blockNumber
            });
            onSyncEventsFromLogs(logs);
        });
        setImmediate(async () => {
            const events = await contract.queryFilter(filter, blockNumber, blockNumber);
            onSyncEventsFromQueryFilter(events);
        })
    })
}
main();
