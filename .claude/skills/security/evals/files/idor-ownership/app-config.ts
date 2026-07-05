import express from 'express';
import rateLimit from 'express-rate-limit';

export function createApp() {
  const app = express();

  // We're behind the company's shared load balancer, which adds
  // X-Forwarded-For — trust it so req.ip reflects the real client.
  app.set('trust proxy', true);

  app.use(express.json());

  return app;
}

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, try again later' },
});

export const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
});
