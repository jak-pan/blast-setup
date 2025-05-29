import { ApiPromise, WsProvider } from "@polkadot/api";
import { Keyring } from "@polkadot/keyring";
import { BN } from "@polkadot/util";
import { decodeAddress } from "@polkadot/util-crypto";

class BlockProducer {
  constructor(provider, { interval = 3000 } = {}) {
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

async function registerExternalAssets(api, signer, assets) {
  console.log("--- REGISTERING EXTERNAL ASSETS ON HYDRATION ---");

  const registerCalls = assets.map(({ assetId, name }) => {
    const location = {
      parents: 1,
      interior: {
        X2: [{ Parachain: 1000 }, { GeneralIndex: assetId }],
      },
    };
    return api.tx.assetRegistry.registerExternal(location);
  });

  await api.tx.utility.batch(registerCalls).signAndSend(signer);
}

async function createAssetsOnAssetHub(api, signer, assets, tokenAmount) {
  console.log("Creating assets on Asset Hub...");

  const assetIds = [];
  const createCalls = [];
  let assetId = (await api.query.assets.nextAssetId()).unwrap();

  for (const asset of assets) {
    // Store the raw number for internal use
    assetIds.push(assetId);

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
      assetId,
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
  const tx = await batchCall.signAndSend(signer);
  console.log("Assets creation transaction hash:", tx.toHex());

  return assetIds;
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

  // Start producing new blocks every 2 seconds
  const assetHubBlockProducer = new BlockProducer(assetHubWsProvider);
  assetHubBlockProducer.start();

  // Start producing new blocks every 2 seconds
  const testnetBlockProducer = new BlockProducer(testnetWsProvider);
  testnetBlockProducer.start();

  const keyring = new Keyring({ type: "sr25519" });
  const alice = keyring.addFromUri("//Alice", { name: "Alice default" });

  console.log("--- CREATING TOKENS ON ASSET HUB ---");

  const assets = JSON.stringify([
    {
      name: "BLAST-1",
      symbol: "BLAST Stage 1",
      decimals: 12,
    },
    {
      name: "FAZE-1",
      symbol: "FAZE Stage 1",
      decimals: 12,
    },
  ]);

  const tokenAmount = new BN(1_000_000_000).mul(new BN(10).pow(new BN(12)));
  const transferAmount = new BN(100_000_000).mul(new BN(10).pow(new BN(12)));

  // Create both tokens in a single batch
  const [blastAssetId, fazeAssetId] = await createAssetsOnAssetHub(
    assetHubApi,
    alice,
    JSON.parse(assets),
    tokenAmount
  );

  // Register external assets on Hydration
  await registerExternalAssets(testnetApi, alice, [
    { assetId: blastAssetId, name: "BLAST-1" },
    { assetId: fazeAssetId, name: "FAZE-1" },
  ]);

  console.log("--- TRANSFERRING TOKENS TO TESTNET ---");

  // Transfer BLAST to testnet
  await transferToTestnet(assetHubApi, alice, {
    assetId: blastAssetId,
    amount: transferAmount,
  });

  // Transfer FAZE to testnet
  await transferToTestnet(assetHubApi, alice, {
    assetId: fazeAssetId,
    amount: transferAmount,
  });

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

  transferCall.signAndSend(signer, (result) => {});
}

main().catch((e) => {
  console.error("An error occurred:", e);
  process.exit(1);
});
