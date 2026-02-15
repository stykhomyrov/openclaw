#!/usr/bin/env node
// DM (Direct Message) end-to-end test: send a DM to the OpenClaw agent via XMPP

const { client, xml } = require('@xmpp/client');

const AGENT_JID = 'agent@localhost';
const TIMEOUT_MS = 30000;

console.log('Testing XMPP DM (Direct Message)...');
console.log('='.repeat(50));

async function main() {
  const testClient = client({
    service: 'xmpp://localhost:5222',
    domain: 'localhost',
    username: 'testuser',
    password: 'testpass',
  });

  testClient.on('error', (err) => {
    console.error('Client error:', err.message);
  });

  let gotResponse = false;

  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!gotResponse) reject(new Error('Timeout: no DM response from agent'));
    }, TIMEOUT_MS);

    testClient.on('stanza', (stanza) => {
      if (stanza.is('message')) {
        const from = stanza.attrs.from || '';
        const type = stanza.attrs.type || '';
        const body = stanza.getChildText('body');

        if (body) {
          console.log(`\nReceived message:`);
          console.log(`  from: ${from}`);
          console.log(`  type: ${type}`);
          console.log(`  body: "${body.substring(0, 120)}..."`);
        }

        if (body && from.includes('agent@localhost')) {
          console.log('\n✅ GOT DM RESPONSE from agent!');
          console.log(`  Body: "${body.substring(0, 200)}"`);
          gotResponse = true;
          clearTimeout(timer);
          resolve(body);
        }
      }
    });
  });

  await testClient.start();
  console.log('✅ Client connected');

  await testClient.send(xml('presence'));
  await new Promise(r => setTimeout(r, 1000));

  const testMessage = 'Hello agent! This is a DM test message.';
  console.log(`\nSending DM to ${AGENT_JID}: "${testMessage}"`);
  await testClient.send(
    xml('message', { to: AGENT_JID, type: 'chat' },
      xml('body', {}, testMessage)
    )
  );
  console.log('✅ Message sent');

  try {
    await done;
    console.log('\n' + '='.repeat(50));
    console.log('✅ DM TEST PASSED - Agent responded to direct message');
    await testClient.stop();
    process.exit(0);
  } catch (err) {
    console.error('\n' + '='.repeat(50));
    console.error('❌ DM TEST FAILED:', err.message);
    await testClient.stop();
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
