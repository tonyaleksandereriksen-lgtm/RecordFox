/*
 * The few atomics the engine needs, without depending on C11 <stdatomic.h> (MSVC support for it
 * is recent and the `cc` crate does not force /std:c11). Aligned 32/64-bit loads and stores are
 * atomic on every CPU we target; what these add is the ordering barrier around them.
 *
 * Used for: publishing a decoded track to the audio thread, sequencing seek requests, and handing
 * playhead/meter values back to the UI thread.
 */
#ifndef RFX_ATOMIC_H
#define RFX_ATOMIC_H

typedef unsigned int       rfx_u32;
typedef unsigned long long rfx_u64;

#if defined(_MSC_VER)
#include <intrin.h>
#define RFX_INLINE static __forceinline

RFX_INLINE rfx_u32 rfx_load_u32(volatile rfx_u32* p)
{
    rfx_u32 v = *p;
    _ReadWriteBarrier();
    return v;
}
RFX_INLINE void rfx_store_u32(volatile rfx_u32* p, rfx_u32 v)
{
    _InterlockedExchange((volatile long*)p, (long)v);
}
RFX_INLINE rfx_u64 rfx_load_u64(volatile rfx_u64* p)
{
    rfx_u64 v = *p;
    _ReadWriteBarrier();
    return v;
}
RFX_INLINE void rfx_store_u64(volatile rfx_u64* p, rfx_u64 v)
{
    _InterlockedExchange64((volatile __int64*)p, (__int64)v);
}

#else
#define RFX_INLINE static inline

RFX_INLINE rfx_u32 rfx_load_u32(volatile rfx_u32* p)  { return __atomic_load_n(p, __ATOMIC_ACQUIRE); }
RFX_INLINE void    rfx_store_u32(volatile rfx_u32* p, rfx_u32 v) { __atomic_store_n(p, v, __ATOMIC_RELEASE); }
RFX_INLINE rfx_u64 rfx_load_u64(volatile rfx_u64* p)  { return __atomic_load_n(p, __ATOMIC_ACQUIRE); }
RFX_INLINE void    rfx_store_u64(volatile rfx_u64* p, rfx_u64 v) { __atomic_store_n(p, v, __ATOMIC_RELEASE); }
#endif

/* Doubles travel as their bit pattern so the load/store stay atomic. */
RFX_INLINE double rfx_load_f64(volatile rfx_u64* p)
{
    union { rfx_u64 u; double d; } v;
    v.u = rfx_load_u64(p);
    return v.d;
}
RFX_INLINE void rfx_store_f64(volatile rfx_u64* p, double d)
{
    union { rfx_u64 u; double d; } v;
    v.d = d;
    rfx_store_u64(p, v.u);
}

#endif /* RFX_ATOMIC_H */
