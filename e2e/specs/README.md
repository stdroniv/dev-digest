# e2e/specs

Browser flows live here as `NN-name.flow.json` (JSON lists of agent-browser
commands — see [`../README.md`](../README.md) for the format), alongside any design
notes for new journeys. Flows must stay deterministic and key-free: read-only
seeded data, `--url`/`--text`/`find` locators only.
