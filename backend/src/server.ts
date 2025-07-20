import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import editorRoutes from '../routers/editor.routes';
const app = express();
const PORT = 5000;

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
}));
app.use(express.json());
app.get('/', (req, res) => {
  res.send('Video Editor backend is running!');
});

app.use('/api/editor', editorRoutes);

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
