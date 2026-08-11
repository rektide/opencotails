import test from "node:test";
import { assertHistoryContract, assertSearchContract } from "@opencoattails/test-contracts";

test("search domain contract", assertSearchContract);
test("history domain contract", assertHistoryContract);
