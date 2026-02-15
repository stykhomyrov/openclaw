#!/usr/bin/env node
// MUC (Multi-User Chat) test: Group chat with OpenClaw agent

const { client, xml } = require('@xmpp/client');

const ROOM_JID = 'testroom@conference.localhost';
const AGENT_JID = 'agent@localhost';
const TIMEOUT_MS = 45000;

console.log('Testing XMPP MUC (Group Chat)...');
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
      if (!gotResponse) reject(new Error('Timeout: no MUC response from agent'));
    }, TIMEOUT_MS);

    // Log ALL stanzas for debugging
    testClient.on('stanza', (stanza) => {
      const name = stanza.name;
      const from = stanza.attrs.from || '';
      const type = stanza.attrs.type || '';

      if (name === 'presence') {
        console.log(`  [presence] from=${from} type=${type || 'available'}`);
        // Check for MUC status codes
        const x = stanza.getChild('x', 'http://jabber.org/protocol/muc#user');
        if (x) {
          const statuses = x.getChildren('status');
          if (statuses.length) {
            console.log(`    MUC statuses: ${statuses.map(s => s.attrs.code).join(', ')}`);
          }
          const items = x.getChildren('item');
          if (items.length) {
            console.log(`    MUC items: ${items.map(i => `role=${i.attrs.role} affiliation=${i.attrs.affiliation} jid=${i.attrs.jid || '?'}`).join(', ')}`);
          }
        }
      } else if (name === 'message') {
        const body = stanza.getChildText('body');
        const subject = stanza.getChildText('subject');
        console.log(`  [message] from=${from} type=${type} body=${body ? `"${body.substring(0, 80)}"` : 'null'} subject=${subject || 'null'}`);

        // Look for agent's response in the MUC room
        if (body && from.startsWith(ROOM_JID) && !from.endsWith('/testuser')) {
          console.log('\n✅ GOT MUC RESPONSE from agent!');
          console.log(`  From: ${from}`);
          console.log(`  Body: "${body.substring(0, 200)}"`);
          gotResponse = true;
          clearTimeout(timer);
          resolve(body);
        }
      } else if (name === 'iq') {
        console.log(`  [iq] from=${from} type=${type} id=${stanza.attrs.id || '?'}`);
      }
    });
  });

  await testClient.start();
  console.log('✅ Client connected');

  // Send presence
  await testClient.send(xml('presence'));
  console.log('✅ Client presence sent');

  // Wait a moment
  await new Promise(r => setTimeout(r, 1000));

  // Join MUC room
  console.log(`\nJoining room: ${ROOM_JID}...`);
  await testClient.send(
    xml('presence', { to: `${ROOM_JID}/testuser` },
      xml('x', { xmlns: 'http://jabber.org/protocol/muc' })
    )
  );
  console.log('✅ Sent MUC join presence');

  // Wait for room join to complete and check who's in the room
  console.log('\nWaiting for room join + checking participants...');
  await new Promise(r => setTimeout(r, 3000));

  // Query room participants via disco
  console.log('\nQuerying room participants...');
  const discoIq = xml('iq', { to: ROOM_JID, type: 'get', id: 'disco1' },
    xml('query', { xmlns: 'http://jabber.org/protocol/disco#items' })
  );
  await testClient.send(discoIq);
  await new Promise(r => setTimeout(r, 2000));

  // Send message to the room
  const testMessage = 'Hello room! Agent, are you here? Please respond.';
  console.log(`\nSending groupchat message: "${testMessage}"`);
  await testClient.send(
    xml('message', { to: ROOM_JID, type: 'groupchat' },
      xml('body', {}, testMessage)
    )
  );
  console.log('✅ Message sent to room');

  try {
    const response = await done;
    console.log('\n' + '='.repeat(50));
    console.log('✅ MUC TEST PASSED - Agent responded in group chat');
    await testClient.stop();
    process.exit(0);
  } catch (err) {
    console.error('\n' + '='.repeat(50));
    console.error('❌ MUC TEST FAILED:', err.message);
    await testClient.stop();
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
