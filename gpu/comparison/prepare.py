"""Prepare only pinned BitCrack libraries; no upstream general-purpose CLI."""
import json,pathlib,hashlib,shutil,sys
here=pathlib.Path(__file__).resolve().parent
source,output=map(pathlib.Path,sys.argv[1:])
expected=json.loads((here.parent/'upstream-lock.json').read_text())['files']
if {p.relative_to(source).as_posix() for p in source.rglob('*') if p.is_file()}!=set(expected):raise ValueError('Unexpected upstream files')
for name,digest in expected.items():
    if hashlib.sha256((source/name).read_bytes()).hexdigest()!=digest:raise ValueError('Upstream mismatch')
if output.exists():raise ValueError('Output must be new')
shutil.copytree(source,output)
p=output/'CudaKeySearchDevice/Makefile';s=p.read_text();assert s.count('${NVCC} -dlink')==1
p.write_text(s.replace('${NVCC} -dlink','${NVCC} ${NVCCFLAGS} -dlink'))
p=output/'CudaKeySearchDevice/CudaKeySearchDevice.cu';s=p.read_text()
for fn in ['doIteration','doIterationWithDouble']:
    old=f'    {fn}(points, compression);'
    assert s.count(old)==1
    s=s.replace(old,old+'\n    __syncthreads();\n    if(threadIdx.x==0) atomicAdd(&benchmarkAttempts,(unsigned long long)blockDim.x*points);')
s='__device__ unsigned long long benchmarkAttempts;\n'+s
s+='''
void resetBenchmarkCounter(){
    unsigned long long zero=0;
    if(cudaMemcpyToSymbol(benchmarkAttempts,&zero,sizeof(zero))!=cudaSuccess)throw KeySearchException("Counter reset failed");
}
unsigned long long readBenchmarkCounter(){
    unsigned long long value=0;
    if(cudaDeviceSynchronize()!=cudaSuccess||cudaMemcpyFromSymbol(&value,benchmarkAttempts,sizeof(value))!=cudaSuccess)throw KeySearchException("Counter read failed");
    return value;
}
'''
p.write_text(s)
(output/'Logger/Logger.cpp').write_text('#include "Logger.h"\nvoid Logger::log(int,std::string) {}\nvoid Logger::setLogFile(std::string) {}\n')
print('Prepared fixed benchmark libraries')
