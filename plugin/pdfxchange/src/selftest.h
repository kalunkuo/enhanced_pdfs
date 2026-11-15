// Self-test mode (same contract as the Acrobat adapter): the Editor is started with env
// SMARTMARKUP_SELFTEST=<outdir> (+ optional SMARTMARKUP_SELFTEST_STEPS=a,b) and a PDF. When that document
// has started viewing, the requested steps run and <outdir>/selftest.json is written:
//   {"ok": true|false, "steps": {"<name>": <step JSON or {"error": "..."}>}}
// plugin/scripts/Run-PxcSelfTest.ps1 waits for the file and then closes the Editor gently.
#pragma once

#include <string>

#include "pxv.h"

using SelfTestStep = std::string (*)(IPXV_Document* doc, const std::string& outDir);

void RegisterSelfTestStep(const char* name, SelfTestStep step);

// Called once from IPXV_Plugin::Init. Does nothing unless SMARTMARKUP_SELFTEST is set.
void InitSelfTest(IPXV_Inst* inst);

std::string JsonString(const std::string& value);
