import { describeAgent, runAgentCases } from "../../src/index.js";
import { cases } from "./test-writer.cases.js";

describeAgent("test-writer", () => runAgentCases("test-writer", cases));
