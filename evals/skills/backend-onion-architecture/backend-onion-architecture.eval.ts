import { describeSkill, runSkillCases } from "../../src/index.js";
import { cases } from "./backend-onion-architecture.cases.js";

describeSkill("backend-onion-architecture", () => runSkillCases("backend-onion-architecture", cases));
