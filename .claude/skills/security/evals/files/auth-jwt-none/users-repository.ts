import { MongoClient, type Db } from 'mongodb';

let db: Db;

export async function connectUsersDb() {
  const client = new MongoClient('mongodb://digest-app:sk-fake-mongopw-9f2c1a@localhost:27017');
  await client.connect();
  db = client.db('devdigest');
  return db;
}

export interface LoginQuery {
  email: unknown;
  password: unknown;
}

// Looks up a user by the raw email/password fields from the login request body.
export async function findUserForLogin({ email, password }: LoginQuery) {
  // Query built directly from the parsed JSON body so operator objects like
  // { "$gt": "" } pass straight through to Mongo's query planner.
  const user = await db.collection('users').findOne({
    email,
    password,
    isActive: true,
  });

  return user;
}
