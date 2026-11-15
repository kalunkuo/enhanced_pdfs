// Self-test mode: lets scripts verify the plug-in inside a real Acrobat without clicking.
//
// Acrobat is started with env SMARTMARKUP_SELFTEST=<outdir> (and optionally
// SMARTMARKUP_SELFTEST_STEPS=a,b,c) plus a PDF path. After that document opens, the plug-in runs the
// requested steps in order (all registered steps if none given) on an idle tick and writes
// <outdir>/selftest.json:  {"ok": true|false, "steps": {"<name>": <step JSON or {"error": "..."}>}}
// plugin/scripts/Run-SelfTest.ps1 waits for that file and then closes Acrobat.
#pragma once

#include <string>

#include "PIHeaders.h"

// A step returns a JSON value (object/array/scalar text). Throwing marks the step and the run as failed.
using SelfTestStep = std::string (*)(PDDoc doc, const std::string& outDir);

void RegisterSelfTestStep(const char* name, SelfTestStep step);

// Called once from PluginInit. Does nothing unless SMARTMARKUP_SELFTEST is set.
void InitSelfTest();

// JSON helpers for steps.
std::string JsonString(const std::string& value);
