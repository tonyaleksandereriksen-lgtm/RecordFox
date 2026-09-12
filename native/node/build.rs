/* Node-API addons on Windows resolve their symbols from the host executable (node.exe or
 * electron.exe) at load time; napi-build sets the delay-load linker flags that make that work. */
fn main() {
    napi_build::setup();
}
