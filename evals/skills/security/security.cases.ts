import type { SkillCase } from "../../src/index.js";

const FIXTURE = `// routes/comments.js
router.post('/generate-reply', async (req, res) => {
  const completion = await ai.generateContent(req.body.prompt);
  const comment = await Comment.create({
    postId: req.body.postId,
    text: completion,
    author: 'AI Assistant',
  });
  res.json({ comment });
});`;

export const cases: SkillCase[] = [
  {
    name: "flags missing prompt/output controls and rate limiting on an AI content-generation endpoint",
    kind: "quality",
    prompt: `Review this Express route for security issues:\n\n\`\`\`js\n${FIXTURE}\n\`\`\``,
    practices: [
      "the answer flags that the AI-generated completion is stored/returned without sanitizing it first, calling out the stored-XSS risk of persisting unsanitized AI output",
      "the answer flags that this endpoint has no rate limiting, and recommends a limit specifically in the range of 3 requests per minute for AI generation, not a generic or login-style limit",
      "the answer flags that the call to ai.generateContent has no request timeout configured, so a slow or hung AI provider call can tie up the request indefinitely",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
];
