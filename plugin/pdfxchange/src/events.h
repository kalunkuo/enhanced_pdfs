// Native event subscriptions on the Editor's event server, by event name ("e.document.beforeSave").
#pragma once

#include <functional>
#include <string>

#include "pxv.h"

// Called on the Editor's UI thread. `from` is the object that fired the event (may be null).
using EventCallback = std::function<void(IEvent* event, IUnknown* from)>;

// Subscribes `callback` to the named event. Returns false (and logs) if the name is unknown.
bool Subscribe(IPXV_Inst* inst, const char* eventName, EventCallback callback);

// Drops every subscription (plug-in unload).
void UnsubscribeAll();

// Probe mode: subscribe to the spec's candidate events and log each as it fires (name, params, source).
void SubscribeProbe(IPXV_Inst* inst);
