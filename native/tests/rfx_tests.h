/* The C test suites, exposed so the Rust `rfx-tests` binary can run them with one cargo command. */
#ifndef RFX_TESTS_H
#define RFX_TESTS_H
int rfx_dsp_test_main(void);
int rfx_engine_test_main(const char* scratchDir);
int rfx_shim_test_main(void);
#endif
