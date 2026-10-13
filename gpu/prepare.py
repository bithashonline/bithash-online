"""Patch only the pinned upstream tree, writing a separate build tree."""
import hashlib, json, pathlib, shutil, sys

source, output = map(pathlib.Path, sys.argv[1:])
expected = json.loads((pathlib.Path(__file__).parent/'upstream-lock.json').read_text())['files']
actual = {p.relative_to(source).as_posix() for p in source.rglob('*') if p.is_file()}
if actual != set(expected): raise SystemExit('Unexpected source files')
for name, digest in expected.items():
    if hashlib.sha256((source/name).read_bytes()).hexdigest() != digest:
        raise SystemExit('Upstream source mismatch')
if output.exists():
    raise SystemExit('Output must be a new directory')
shutil.copytree(source, output)
def edit(name, before, after):
    p=output/name
    text=p.read_text()
    if text.count(before)!=1: raise SystemExit('Patch context mismatch: '+name)
    p.write_text(text.replace(before, after))

edit('CudaKeySearchDevice/Makefile', '${NVCC} -dlink', '${NVCC} ${NVCCFLAGS} -dlink')
edit('CudaKeySearchDevice/CudaKeySearchDevice.h', '    int _device;', '    int _device;\n    int _fixtureCount = 0;')
edit('CudaKeySearchDevice/CudaKeySearchDevice.h', '    virtual void doStep();', '    void setFixtureCount(int count) { _fixtureCount = count; }\n    virtual void doStep();')
edit('CudaKeySearchDevice/cudabridge.h', 'void waitForKernel();', 'void waitForKernel();\nvoid callBoundedFixture(int count);')
p=output/'CudaKeySearchDevice/CudaKeySearchDevice.cpp'
s=p.read_text(); start=s.index('    try {', s.index('void CudaKeySearchDevice::doStep()')); end=s.index('    getResultsInternal();', start)
s=s[:start]+'''    if (_iterations != 0 || _blocks != 1 || _threads != 32 || _pointsPerThread != 1 || _fixtureCount < 1 || _fixtureCount > 4)
        throw KeySearchException("Invalid bounded fixture configuration");
    callBoundedFixture(_fixtureCount);

'''+s[end:]; p.write_text(s)
# No upstream CLI, private-key callbacks or checkpoint writer are used.
# This kernel hashes ONLY active lanes; upstream EC initialization still pads to 32 lanes.
p=output/'CudaKeySearchDevice/CudaKeySearchDevice.cu'
p.write_text(p.read_text()+'''
__device__ unsigned int fixtureAttempts;
__global__ void boundedFixtureKernel(int count) {
    if (threadIdx.x >= count) return;
    unsigned int x[8], y[8], digest[5];
    readInt(ec::getXPtr(), 0, x);
    readInt(ec::getYPtr(), 0, y);
    hashPublicKeyCompressed(x, y[7], digest);
    atomicAdd(&fixtureAttempts, 1);
    if (checkHash(digest)) setResultFound(0, true, x, y, digest);
}
void callBoundedFixture(int count) {
    unsigned int attempts = 0;
    if (cudaMemcpyToSymbol(fixtureAttempts, &attempts, sizeof(attempts)) != cudaSuccess)
        throw KeySearchException("Counter initialization failed");
    boundedFixtureKernel<<<1,32>>>(count);
    if (cudaGetLastError() != cudaSuccess || cudaDeviceSynchronize() != cudaSuccess)
        throw KeySearchException("Fixture kernel failed");
    if (cudaMemcpyFromSymbol(&attempts, fixtureAttempts, sizeof(attempts)) != cudaSuccess || attempts != count)
        throw KeySearchException("Fixture coverage mismatch");
}
''')
# Keep upstream progress messages off the worker JSON stream.
(output/'Logger/Logger.cpp').write_text('#include "Logger.h"\nvoid Logger::log(int, std::string) {}\nvoid Logger::setLogFile(std::string) {}\n')
print('Prepared bounded fixture source; not GPU validated')
