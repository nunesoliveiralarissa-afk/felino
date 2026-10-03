'use strict';
// Persistência simples em JSON com escrita atômica (tmp + rename).
// Node é single-thread: operações síncronas sobre `state` são atômicas entre si.
const fs = require('fs');
const path = require('path');
const { DATA_FILE } = require('./config');

let state = { nextId: 1, users: {}, sessions: {} };
const byUsername = new Map();
let timer = null;

function load() {
  try {
    state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[db] falha ao ler, iniciando vazio:', e.message);
  }
  byUsername.clear();
  for (const u of Object.values(state.users)) byUsername.set(u.username.toLowerCase(), u.id);
}

function flush() {
  clearTimeout(timer);
  timer = null;
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, DATA_FILE);
}

function save() {
  if (!timer) timer = setTimeout(flush, 400);
}

const getUser = (id) => state.users[id] || null;
const findByUsername = (name) => getUser(byUsername.get(String(name).toLowerCase()));

function createUser(user) {
  const id = String(state.nextId++);
  state.users[id] = { id, ...user };
  byUsername.set(user.username.toLowerCase(), id);
  save();
  return state.users[id];
}

const sessions = () => state.sessions;
const allUsers = () => Object.values(state.users);

process.on('exit', () => { if (timer) flush(); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { if (timer) flush(); process.exit(0); });

module.exports = { load, save, flush, getUser, findByUsername, createUser, sessions, allUsers };
