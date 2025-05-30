import { ApiPromise, WsProvider } from "@polkadot/api";
import { Keyring } from "@polkadot/keyring";
import { BN } from "@polkadot/util";
import { decodeAddress } from "@polkadot/util-crypto";
import { readFileSync, writeFileSync } from "fs";

class BlockProducer {
  constructor(provider, { interval = 6000 } = {}) {
    this.provider = provider;
    this.interval = interval;
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(async () => {
      try {
        await this.provider.send("dev_newBlock", []);
      } catch (error) {
        console.error("Error producing block:", error);
      }
    }, this.interval);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
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
    (amountA.toNumber() / initialPrice).toFixed(0)
  );

  return createPoolCall;
}

async function sendAndWait(tx, signer, description) {
  return new Promise((resolve, reject) => {
    tx.signAndSend(signer, (result) => {
      if (result.status.isInBlock) {
        console.log(`${description} in block ${result.status.asInBlock}`);
        resolve(result);
      } else if (result.isError) {
        console.error(`Transaction error:`, result.asError);
        reject(result.asError);
      }
    }).catch((error) => {
      console.error(`Error sending ${description}:`, error);
      reject(error);
    });
  });
}

async function registerExternalAssets(api, signer, assets) {
  console.log("--- REGISTERING EXTERNAL ASSETS ON HYDRATION ---");

  const currentAssetId = (await api.query.assetRegistry.nextAssetId()).sub(
    new BN(1)
  );
  const assetMetadata = [];

  const registerCalls = assets.map(
    ({ assetId, name, symbol, decimals }, index) => {
      const location = {
        parents: 1,
        interior: {
          X3: [
            { Parachain: 1000 },
            { PalletInstance: 50 },
            { GeneralIndex: assetId.toNumber() },
          ],
        },
      };

      assetMetadata.push({
        assetId: currentAssetId.add(new BN(index + 1)).toNumber() + 1000000,
        assetHubAssetId: assetId.toNumber(),
        name,
        symbol,
        decimals,
        location,
      });

      return api.tx.assetRegistry.registerExternal(location);
    }
  );

  // write asset metadata to file
  writeFileSync(
    `./asset-metadata.json`,
    JSON.stringify(assetMetadata, null, 2)
  );

  const batchCall = api.tx.utility.batch(registerCalls);
  await sendAndWait(batchCall, signer, "Asset registration");
  return assetMetadata;
}

async function createAssetsOnAssetHub(api, signer, assets, tokenAmount) {
  console.log("Creating assets on Asset Hub...");

  const assetMetadata = [];
  const createCalls = [];
  let assetId = (await api.query.assets.nextAssetId()).unwrap().toString();

  for (const asset of assets) {
    // Store the raw number for internal use
    assetMetadata.push({
      assetId,
      name: asset.name,
      symbol: asset.symbol,
      decimals: asset.decimals,
      initialPrice: asset.initialPrice,
    });

    const createAssetCall = api.tx.assets.create(assetId, signer.address, 1000);

    const setMetadataCall = api.tx.assets.setMetadata(
      assetId,
      asset.name,
      asset.symbol,
      asset.decimals
    );

    //mint tokens
    const mintTokensCall = api.tx.assets.mint(
      assetId,
      signer.address,
      tokenAmount
    );

    //touch hydration account
    const touchOtherCall = api.tx.assets.touchOther(
      assetId.toString(),
      "13cKp89Uh2yWgTG28JA1QEvPUMjEPKejqkjHKf9zqLiFKjH6"
    );

    createCalls.push(
      createAssetCall,
      setMetadataCall,
      mintTokensCall,
      touchOtherCall
    );

    // Increment assetId for next iteration
    assetId = new BN(assetId).add(new BN(1));
  }

  const batchCall = api.tx.utility.batch(createCalls);
  await sendAndWait(batchCall, signer, "Assets creation");
  return assetMetadata;
}

async function progress_blocks(wsProvider, count) {
  await wsProvider.send("dev_newBlock", [{ count }]);
}

async function main() {
  console.log("CONNECTING TO ASSET HUB");

  // Connect to Asset Hub
  const assetHubWsProvider = new WsProvider("ws://localhost:8001");
  const assetHubApi = await ApiPromise.create({
    provider: assetHubWsProvider,
  });

  await assetHubApi.isReady;

  // Connect to Testnet
  const testnetWsProvider = new WsProvider("ws://localhost:8000");
  const testnetApi = await ApiPromise.create({
    provider: testnetWsProvider,
  });

  await testnetApi.isReady;

  const relayWsProvider = new WsProvider("ws://localhost:8002");

  // Start producing new blocks every 2 seconds
  const assetHubBlockProducer = new BlockProducer(assetHubWsProvider);
  assetHubBlockProducer.start();

  // Start producing new blocks every 2 seconds
  const testnetBlockProducer = new BlockProducer(testnetWsProvider);
  testnetBlockProducer.start();

  const keyring = new Keyring({ type: "sr25519" });
  const alice = keyring.addFromUri("//Alice", { name: "Alice default" });

  console.log("--- CREATING TOKENS ON ASSET HUB ---");

  // Read asset configurations from file
  let assets = JSON.parse(readFileSync("./assets.json", "utf8"));

  // just 3 assets
  // assets = assets.slice(0, 3);

  const tokenAmount = new BN(1_100_000_000).mul(new BN(10).pow(new BN(12)));
  const transferAmount = new BN(1_000_000_000).mul(new BN(10).pow(new BN(12)));
  const initialPoolSize = new BN(1000).mul(new BN(10).pow(new BN(12)));

  // Create both tokens in a single batch
  const registeredAssets = await createAssetsOnAssetHub(
    assetHubApi,
    alice,
    assets,
    tokenAmount
  );

  // Register external assets on Hydration
  const assetMetadata = await registerExternalAssets(
    testnetApi,
    alice,
    registeredAssets.map((asset) => ({
      assetId: new BN(asset.assetId),
      name: asset.name,
      symbol: asset.symbol,
      decimals: asset.decimals,
    }))
  );

  await progress_blocks(assetHubWsProvider, 1);
  await progress_blocks(relayWsProvider, 1);
  await progress_blocks(testnetWsProvider, 1);

  console.log("--- TRANSFERRING TOKENS TO TESTNET ---");

  // Transfer tokens to testnet
  for (const asset of assetMetadata) {
    await transferToTestnet(assetHubApi, alice, {
      assetId: new BN(asset.assetHubAssetId),
      amount: transferAmount,
    });

    await progress_blocks(assetHubWsProvider, 1);
    await progress_blocks(relayWsProvider, 1);
    await progress_blocks(testnetWsProvider, 1);
  }

  console.log("--- CREATING POOLS ON TESTNET ---");

  const poolCalls = [];

  const firstPoolCall = await createXykPool(testnetApi, {
    tokenA: new BN(5),
    tokenB: new BN(assetMetadata[0].assetId),
    amountA: new BN(100).mul(new BN(10).pow(new BN(10))),
    initialPrice: 0.001,
  });
  await sendAndWait(firstPoolCall, alice, "First pool creation");

  for (let i = 0; i < assetMetadata.length; i++) {
    if (i === 0) continue;
    const asset = assetMetadata[i];
    const poolCall = await createXykPool(testnetApi, {
      tokenA: new BN(assetMetadata[0].assetId),
      tokenB: new BN(asset.assetId),
      amountA: initialPoolSize,
      initialPrice: asset.initialPrice,
    });

    poolCalls.push(poolCall);
  }

  const batchCall = testnetApi.tx.utility.batch(poolCalls);
  await sendAndWait(batchCall, alice, "Pool creation batch");

  console.log("--- SETUP COMPLETE ---");
}

async function transferToTestnet(api, signer, { assetId, amount }) {
  console.log(`Transferring asset ${assetId} to testnet...`);

  // Convert the SS58 address to a 32-byte array
  const accountId = decodeAddress(signer.address);

  const transferCall = api.tx.polkadotXcm.limitedReserveTransferAssets(
    {
      V4: {
        parents: 1,
        interior: {
          X1: [{ Parachain: 2034 }],
        },
      },
    },
    {
      V4: {
        parents: 0,
        interior: {
          X1: [
            {
              AccountId32: {
                network: null,
                id: accountId,
              },
            },
          ],
        },
      },
    },
    {
      V4: [
        {
          id: {
            parents: 0,
            interior: {
              X2: [{ PalletInstance: 50 }, { GeneralIndex: assetId }],
            },
          },
          fun: {
            Fungible: amount,
          },
        },
        {
          id: {
            parents: 1,
            interior: "Here",
          },
          fun: {
            Fungible: 1000000000,
          },
        },
      ],
    },
    1,
    "Unlimited"
  );

  console.log(transferCall.toHex());
  await sendAndWait(transferCall, signer, "Token transfer");
}

main().catch((e) => {
  console.error("An error occurred:", e);
  process.exit(1);
});
