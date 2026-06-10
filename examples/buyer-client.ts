// examples/buyer-client.ts
// A demo buyer agent that pays the seller per call. It fetches the 402-gated
// report, pays the required USDC on Atlantic, retries with the X-PAYMENT header,
// and prints the report. Pass --replay to resend the same payment and watch the
// seller block it with a VOID (idempotency in action).
//
// Run: TOLLGATE_PRIVATE_KEY=0x... npm run buyer

import { parseUnits, formatUnits, type Hash } from "viem";
import {
  erc20Abi,
  publicClient,
  walletClient,
  loadAccount,
  assertCanSubmitTx,
  EXPLORER_URL,
} from "../src/chain.js";
import { claimMessage } from "../src/facilitator.js";

const URL = process.env.BUYER_URL ?? "http://localhost:4021/report";
const replay = process.argv.includes("--replay");

async function main() {
  const account = loadAccount();
  console.log(`buyer ${account.address} paying ${URL}`);

  // 1. Ask for the resource. Expect 402 with requirements.
  const first = await fetch(URL);
  if (first.status !== 402) {
    console.log("resource did not ask for payment:", first.status);
    console.log(await first.text());
    return;
  }
  const body: any = await first.json();
  const req = body.accepts[0];
  const decimals = req.decimals ?? 6;
  const atomic = BigInt(req.amount);
  console.log(`price ${formatUnits(atomic, decimals)} USDC to ${req.payTo}`);

  // 2. Pay: broadcast an ERC-20 transfer (token is not EIP-3009, so no gasless path).
  await assertCanSubmitTx(account.address);
  const wallet = walletClient();
  const txHash: Hash = await wallet.writeContract({
    account,
    chain: undefined,
    address: req.asset,
    abi: erc20Abi,
    functionName: "transfer",
    args: [req.payTo, atomic],
  });
  console.log(`paid in ${txHash}`);
  console.log(`  ${EXPLORER_URL}/tx/${txHash}`);
  await publicClient().waitForTransactionReceipt({ hash: txHash });

  // 3. Build the X-PAYMENT header and retry.
  const payment = {
    x402Version: 1,
    scheme: req.scheme,
    network: req.network,
    payload: {
      txHash,
      from: account.address,
      to: req.payTo,
      asset: req.asset,
      value: atomic.toString(),
      claimSignature: await account.signMessage({ message: claimMessage(txHash) }),
    },
  };
  const header = Buffer.from(JSON.stringify(payment)).toString("base64");

  const paid = await fetch(URL, { headers: { "X-PAYMENT": header } });
  console.log("first claim status:", paid.status);
  console.log(JSON.stringify(await paid.json(), null, 2));

  // 4. Optional replay: resend the exact same payment. The seller must VOID it.
  if (replay) {
    const again = await fetch(URL, { headers: { "X-PAYMENT": header } });
    console.log("\nreplay status:", again.status, "(expect 409, blocked by idempotency)");
    console.log(JSON.stringify(await again.json(), null, 2));
  }
}

main().catch((err) => {
  console.error("buyer failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
