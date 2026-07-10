import type { Router } from 'express';
import express from 'express';
import jwt from 'jsonwebtoken';
import { findUserForLogin } from './users-repository.js';

export const authRouter: Router = express.Router();

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body;

  const user = await findUserForLogin({ email, password });

  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = jwt.sign(
    { userId: user._id, email: user.email, role: user.role },
    process.env.JWT_SECRET as string,
    { expiresIn: '7d' },
  );

  res.json({ token, user: { id: user._id, email: user.email } });
});
