import { ethers } from "ethers";

type State = {
    logsFromPoller1: number | undefined,
    logsFromPoller2: number | undefined,
}
const state = new Map<number, State>();
const label = "SYNC-EVENT";

function isMisaligned(blockNumber: number): boolean {
    const s = state.get(blockNumber);
    return !!s && // <-- do we have state information at all?
        typeof s.logsFromPoller1 === "number" && // <-- let's make sure that both pollers completed their work
        typeof s.logsFromPoller2 === "number" &&
        s.logsFromPoller1 !== s.logsFromPoller2; // <-- did pollers yield a different number of logs?
}

function lookForMisalignedState(blockNumber: number) {
    if (isMisaligned(blockNumber)) {
        console.timeLog(label, "found misaligned state", blockNumber, state.get(blockNumber));
        process.exit(1);
    }
}

function updateState(blockNumber: number, value: number, key: keyof State): void {
    const s = state.get(blockNumber);
    state.set(blockNumber, {
        logsFromPoller1: undefined,
        logsFromPoller2: undefined,
        ...(s ?? {}),
        [key]: value
    });
}

async function poll(provider: ethers.providers.Provider, filter: ethers.EventFilter, blockNumber: number, key: keyof State) {
    const logs = await provider.getLogs({
        ...filter,
        fromBlock: blockNumber,
        toBlock: blockNumber
    });
    updateState(blockNumber, logs.length, key);
    lookForMisalignedState(blockNumber);
}

function main() {
    console.log("started at", new Date().toISOString());
    console.time(label);
    const url = "https://bsc-dataseed.binance.org/";
    const provider = new ethers.providers.JsonRpcProvider(url);
    const contract = new ethers.Contract("0x8fa59693458289914db0097f5f366d771b7a7c3f", [
        "event Sync(uint112 reserve0, uint112 reserve1)"
    ], provider)
    
    const filter = contract.filters["Sync"]();
    provider.on("block", blockNumber => {
        console.log("new block", blockNumber);
        setImmediate(() => poll(provider, filter, blockNumber, "logsFromPoller1"));
        setImmediate(() => poll(provider, filter, blockNumber, "logsFromPoller2"));
    });
}
main();
