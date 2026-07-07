import { describeAgent, runAgentCases } from "../../src/index.js";
import { cases } from "./spec-conformance.cases.js";

describeAgent("spec-conformance", () => runAgentCases("spec-conformance", cases));
