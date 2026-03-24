/**
 * add-user.js
 * Run this script to add users to users.json
 * Usage:  node add-user.js admin@diu.iiitvadodara.ac.in MyPassword123
 *         node add-user.js faculty1@diu.iiitvadodara.ac.in AnotherPass456
 */

const bcrypt = require('bcryptjs');
const fs     = require('fs');
const path   = require('path');

const USERS_FILE = path.join(__dirname, 'users.json');
const DOMAIN     = '@diu.iiitvadodara.ac.in';

async function addUser(email, password) {
  if (!email || !password) {
    console.error('Usage: node add-user.js <email> <password>');
    process.exit(1);
  }

  if (!email.endsWith(DOMAIN)) {
    console.error(`❌ Email must end with ${DOMAIN}`);
    process.exit(1);
  }

  // Load existing users
  let users = [];
  if (fs.existsSync(USERS_FILE)) {
    users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  }

  // Check duplicate
  if (users.find(u => u.email === email)) {
    console.error(`❌ User ${email} already exists. Remove them from users.json first.`);
    process.exit(1);
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, 10);

  users.push({ email, passwordHash, name: email.split('@')[0], role: 'user' });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

  console.log(`✅ User added: ${email}`);
  console.log(`   users.json now has ${users.length} user(s).`);
}

const [,, email, password] = process.argv;
addUser(email, password);