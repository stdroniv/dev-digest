import { describeAgent, runAgentCases } from "../../src/index.js";
import { cases } from "./implementation-plan.cases.js";

describeAgent("implementation-plan", () => runAgentCases("implementation-plan", cases));
