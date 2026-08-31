import { evaluateAIOrganizer } from "../lib/organizer/evaluation.ts";

console.log(JSON.stringify(await evaluateAIOrganizer(), null, 2));
