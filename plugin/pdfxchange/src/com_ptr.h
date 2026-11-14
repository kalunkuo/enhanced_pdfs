// Minimal owning COM pointer (raw_interfaces_only imports have no smart pointers).
#pragma once

#include <unknwn.h>

template <class T>
class ComPtr {
public:
    ComPtr() = default;
    ~ComPtr() { Reset(); }
    ComPtr(const ComPtr&) = delete;
    ComPtr& operator=(const ComPtr&) = delete;
    ComPtr(ComPtr&& other) noexcept : p_(other.p_) { other.p_ = nullptr; }

    T* Get() const { return p_; }
    T* operator->() const { return p_; }
    explicit operator bool() const { return p_ != nullptr; }
    // For out-parameters: releases the current pointer, returns its address.
    T** Put() {
        Reset();
        return &p_;
    }
    void Reset() {
        if (p_) p_->Release();
        p_ = nullptr;
    }
    // Takes a new reference to `p` (does not adopt).
    void Attach(T* p) {
        if (p) p->AddRef();
        Reset();
        p_ = p;
    }
    template <class U>
    HRESULT As(ComPtr<U>& out) const {
        return p_ ? p_->QueryInterface(__uuidof(U), reinterpret_cast<void**>(out.Put())) : E_POINTER;
    }

private:
    T* p_ = nullptr;
};
