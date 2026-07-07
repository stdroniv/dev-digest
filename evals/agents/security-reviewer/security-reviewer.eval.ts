import { describeAgent, runAgentCases } from "../../src/index.js";
import { cases } from "./security-reviewer.cases.js";

describeAgent("security-reviewer", () => runAgentCases("security-reviewer", cases));
