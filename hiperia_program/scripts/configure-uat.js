import { createClient } from "./client.js";

const tester = process.argv[2];
if (!tester) throw new Error("Pass the public address of the UAT test wallet.");
const { client } = await createClient();
const signature = await client.configureUat(tester);
const config = await client.getConfig();
console.log(
  JSON.stringify({
    signature,
    uatEnabled: config.uatEnabled,
    tester: config.uatTester,
  }),
);
