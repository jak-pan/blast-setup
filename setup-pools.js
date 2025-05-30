import { ApiPromise, WsProvider } from "@polkadot/api";
import { Keyring } from "@polkadot/api";

async function main() {
  console.log("CONNECTING TO NODE");

  const wsProvider = new WsProvider("ws://localhost:8000");
  const api = await ApiPromise.create({
    provider: wsProvider,
  });

  await api.isReady;

  const keyring = new Keyring({ type: "sr25519" });
  const singer = keyring.addFromUri("//Alice", { name: "Alice default" });
  //ALICE 'bottom drive obey lake curtain smoke basket hold race lonely fit walk//Alice'
  //BOB 'bottom drive obey lake curtain smoke basket hold race lonely fit walk//Bob'

  console.log("--- RUNNING POOL SETUP ---");

  console.log("--- SETUP COMPLETE ---");
}

async function createXykPool(
  api,
  { tokenA, tokenB, amountA, initialPrice = 1 }
) {
  // Create and sign the pool creation call
  const createPoolCall = api.tx.xyk.createPool(
    tokenA,
    amountA,
    tokenB,
    amountB
  );

  return createPoolCall;
}

async function progress_blocks(wsProvider, count) {
  console.log("Progressing to next block");

  await wsProvider.send("dev_newBlock", [{ count: count }]);
}

async function setManualBlocks(ws_provider) {
  await ws_provider.send("dev_setBlockBuildMode", ["Manual"]);
}

async function setInstantBlocks(ws_provider) {
  await ws_provider.send("dev_setBlockBuildMode", ["Instant"]);
}

async function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

main().catch((e) => {
  console.error("An error occurred:", e);
  process.exit(0);
});
