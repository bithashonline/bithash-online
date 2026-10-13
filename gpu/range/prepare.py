"""Verify pinned libraries and add exact active-lane hashing/counts.

Use a new output tree; never mutate the validated upstream or benchmark trees.
"""
import hashlib, json, pathlib, shutil, sys
here = pathlib.Path(__file__).resolve().parent
source, output = map(pathlib.Path, sys.argv[1:])
expected = json.loads((here.parent/'upstream-lock.json').read_text())['files']
if {p.relative_to(source).as_posix() for p in source.rglob('*') if p.is_file()} != set(expected):
    raise ValueError('Unexpected upstream files')
for name, digest in expected.items():
    if hashlib.sha256((source/name).read_bytes()).hexdigest() != digest:
        raise ValueError('Upstream mismatch')
if output.exists(): raise ValueError('Output must be new')
shutil.copytree(source, output)
p = output/'CudaKeySearchDevice/Makefile'
s = p.read_text()
assert s.count('${NVCC} -dlink') == 1
p.write_text(s.replace('${NVCC} -dlink', '${NVCC} ${NVCCFLAGS} -dlink'))
p = output/'CudaKeySearchDevice/CudaKeySearchDevice.cu'
s = p.read_text()
for fn, following in [('doIteration', '__device__ void doIterationWithDouble'),
                      ('doIterationWithDouble', '/**\n* Performs a single iteration')]:
    start = s.index('__device__ void '+fn+'(')
    end = s.index(following, start+1)
    body = s[start:end]
    body = body.replace('    unsigned int *chain = _CHAIN[0];',
                        '    unsigned long long rangeLocal = 0;\n    unsigned int *chain = _CHAIN[0];', 1)
    condition = 'if(compression == PointCompressionType::COMPRESSED || compression == PointCompressionType::BOTH)'
    assert body.count(condition) == 1
    body = body.replace(condition,
        'if((compression == PointCompressionType::COMPRESSED || compression == PointCompressionType::BOTH) &&\n'
        '           (unsigned long long)i * gridDim.x * blockDim.x + blockIdx.x * blockDim.x + threadIdx.x < rangeActive)')
    call = 'hashPublicKeyCompressed(x, readIntLSW(yPtr, i), digest);'
    assert body.count(call) == 1
    body = body.replace(call, call+'\n            rangeLocal++;')
    # One device-side atomic per active thread, after its actual hashes.
    last = body.rfind('}')
    body = body[:last]+'    if(rangeLocal) atomicAdd(&rangeAttempts, rangeLocal);\n'+body[last:]
    s = s[:start]+body+s[end:]
s = '__constant__ unsigned long long rangeActive;\n__device__ unsigned long long rangeAttempts;\n'+s
s += '''
void configureRangeStep(unsigned long long active){
    if(!active || cudaMemcpyToSymbol(rangeActive,&active,sizeof(active))!=cudaSuccess)
        throw KeySearchException("Range initialization failed");
}
void resetRangeCounter(){
    unsigned long long zero=0;
    if(cudaMemcpyToSymbol(rangeAttempts,&zero,sizeof(zero))!=cudaSuccess)
        throw KeySearchException("Range counter reset failed");
}
unsigned long long readRangeCounter(){
    unsigned long long value=0;
    if(cudaDeviceSynchronize()!=cudaSuccess || cudaMemcpyFromSymbol(&value,rangeAttempts,sizeof(value))!=cudaSuccess)
        throw KeySearchException("Range counter read failed");
    return value;
}
'''
p.write_text(s)
(output/'Logger/Logger.cpp').write_text('#include "Logger.h"\nvoid Logger::log(int,std::string) {}\nvoid Logger::setLogFile(std::string) {}\n')
print('Prepared exact bounded range libraries; GPU execution unvalidated')
