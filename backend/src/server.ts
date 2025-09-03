import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import editorRoutes from '../routers/editor.routes';
import videoRoutes from '../routers/video.routes';
import { connectToDatabase } from './config/db';
const app = express();
const PORT = 5000;

app.use(cors({
  origin: 'http://localhost:3000',
}));
app.use(express.json());
app.get('/', (req, res) => {
  res.send('Video Editor backend is running!');
});

app.use('/api/editor', editorRoutes);
app.use('/api/videos', videoRoutes);

connectToDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB', err);
    process.exit(1);
  });
