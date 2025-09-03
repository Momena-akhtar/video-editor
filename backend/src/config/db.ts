import mongoose from 'mongoose';

let isConnected = false;

export async function connectToDatabase(): Promise<typeof mongoose> {
  if (isConnected) {
    return mongoose;
  }

  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/video_editor_mvp';

  mongoose.set('strictQuery', true);

  await mongoose.connect(mongoUri, {
    dbName: process.env.MONGODB_DB || undefined,
  });

  isConnected = true;
  return mongoose;
}


