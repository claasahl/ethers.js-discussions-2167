import { ethers } from "ethers";

type State = {
    fromContract: number | undefined,
    fromQueryFilter: number | undefined,
    received: number
}
const state = new Map<string, State>();
const label = "SYNC-EVENT";

function onSyncEventFromContract(reserve0: ethers.BigNumber, reserve1: ethers.BigNumber, event: ethers.Event): void {
    const key = `${reserve0},${reserve1}`;
    console.log("fromContract   ", key, event.blockNumber);
    const value = state.get(key);
    state.set(key, {
        fromContract: event.blockNumber, // <-- mark event as "received via contract.on(...)"
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
            fromQueryFilter: event.blockNumber, // <-- mark event as "received via contact.queryFilter(...)"
            received: Date.now()
        })
    }
}

function onErrorFromContract(error: Error, event: ethers.Event): void {
    console.log("fromContract >> error:", error, event)
}

function lookForMissingEventsFromContract(callback: (state: State) => void) {
    const halfMinute = 30000;
    for (const [key, value] of state.entries()) {
        const now = Date.now();
        if (now - halfMinute < value.received) {
            // let's wait for the timeout
        } else if (value.fromContract && value.fromQueryFilter) {
            // event was received via contract.on(...) and contract.queryFilter(...)
            // i.e. everything is just fine :)
            state.delete(key); // <-- trying to keep the state/cache as small as possible
            continue;
        } else if(value.fromQueryFilter) {
            console.timeLog(label, "found missing event", key, value);
            callback(value);
        }
    }
}

function main() {
    console.log("started at", new Date().toISOString());
    console.time(label);
    const url = "https://bsc-dataseed.binance.org/";
    const provider = new ethers.providers.JsonRpcProvider(url);
    const contract = new ethers.Contract("0x8fa59693458289914db0097f5f366d771b7a7c3f", [
        "event Sync(uint112 reserve0, uint112 reserve1)"
    ], provider)

    // eventually, this will skip "Sync" events
    contract.on("Sync", onSyncEventFromContract);
    contract.on("error", onErrorFromContract);

    // poll "Sync" events for reference
    const filter = contract.filters["Sync"]();
    const onMissingEvent = (value: State) => {
        const blockNumber = value.fromContract || value.fromQueryFilter || 0;
        provider.getLogs({
            ...filter,
            fromBlock: blockNumber,
            toBlock: blockNumber
        }).then(logs => {
            const abi = new ethers.utils.AbiCoder();
            logs.forEach(log => {
                const [reserve0, reserve1] = abi.decode(["uint112", "uint112"], log.data);
                const key = `${reserve0},${reserve1}`;
                console.log("fromGetLogs", key, log.blockNumber);
            });
            process.exit(1);
        }).catch(err => {
            console.log(">>> err", err);
            process.exit(1);
        })
    }
    provider.on("block", blockNumber => {
        console.log("new block", blockNumber);
        lookForMissingEventsFromContract(onMissingEvent); // <-- use "block"-events as the driving force to (re-)check for missing events
        setImmediate(async () => {
            const events = await contract.queryFilter(filter, blockNumber);
            onSyncEventsFromQueryFilter(events);
        })
    })
}
main();
