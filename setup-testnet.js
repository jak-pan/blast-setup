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

  console.log("--- RUNNING CHAIN SETUP ---");

  await setInstantBlocks(wsProvider);

  // Register BLAST token
  const blastCalls = await registerAsset(api, singer, {
    tokenId: 9999,
    name: "BLAST",
    ticker: "BLAST",
  });

  await executeRootBatch(api, wsProvider, blastCalls);

  const fazeCalls = await registerAsset(api, singer, {
    tokenId: 9998,
    name: "FAZE",
    ticker: "FAZE",
  });

  await executeRootBatch(api, wsProvider, fazeCalls);

  // Create XYK pool between BLAST and FAZE
  const initialLiquidity = BigInt(1_000) * BigInt(10) ** BigInt(12); // 1M tokens each
  await createXykPool(api, singer, {
    tokenA: 9999, // BLAST
    tokenB: 9998, // FAZE
    amountA: initialLiquidity,
    amountB: initialLiquidity,
    initialPrice: 1,
  });

  console.log("--- SETUP COMPLETE ---");
}

async function registerAsset(
  api,
  signer,
  { tokenId, name, ticker, decimals = 12 }
) {
  // Create the register asset call
  const registerCall = api.tx.assetRegistry.register(
    tokenId,
    name,
    "Token",
    1000,
    ticker,
    decimals,
    null,
    null,
    true
  );

  // Create the set price call
  const setPriceCall = api.tx.multiTransactionPayment.addCurrency(
    tokenId,
    1000
  );

  // Create the set balance call
  const amount = BigInt(100_000) * BigInt(10) ** BigInt(decimals);
  const setBalanceCall = api.tx.tokens.setBalance(
    signer.address,
    tokenId,
    amount,
    0
  );

  return [registerCall, setPriceCall, setBalanceCall];
}

async function executeRootBatch(api, wsProvider, calls) {
  console.log("Getting current block number");
  const number = (await api.rpc.chain.getHeader()).number.toNumber();
  console.log("Current block number:", number);

  // Create a batch transaction with all operations
  const batchCall = api.tx.utility.batch(calls);

  // Extract the proper call data without the extrinsic wrapper
  const batchEncoded = batchCall.method.toHex();
  console.log("Batch call encoded:", batchEncoded);

  const scheduleData = {
    scheduler: {
      agenda: [
        [
          [number + 1],
          [
            {
              call: {
                Inline: batchEncoded,
              },
              origin: {
                system: "Root",
              },
            },
          ],
        ],
      ],
    },
  };

  await wsProvider.send("dev_setStorage", [scheduleData]);
  console.log("Creating block to execute all operations");
  await wsProvider.send("dev_newBlock", []);

  console.log("Batch execution completed");
}

async function createXykPool(
  api,
  signer,
  { tokenA, tokenB, amountA, amountB, initialPrice = 1 }
) {
  // Create and sign the pool creation call
  const createPoolCall = api.tx.xyk.createPool(
    tokenA,
    amountA,
    tokenB,
    amountB
  );

  const tx = await createPoolCall.signAndSend(signer);
  console.log("Pool creation transaction hash:", tx.toHex());
  return tx;
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
