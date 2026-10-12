#!/usr/bin/env bash
set -euo pipefail
src=$(realpath "$1")
cuda=$(realpath "$2")
out=$(realpath -m "$3")
here=$(cd -- "$(dirname -- "$0")" && pwd)
mkdir -p "$src/lib" "$(dirname "$out")"
export PATH="$cuda/bin:$PATH"
make -C "$src" dir_cudaKeySearchDevice SHELL=/bin/bash '.SHELLFLAGS=-ec' BUILD_CUDA=1 COMPUTE_CAP=86 CUDA_HOME="$cuda" CXXFLAGS='-O2 -std=c++14' NVCCFLAGS='-std=c++14 -gencode=arch=compute_86,code=sm_86 -gencode=arch=compute_89,code=sm_89 -gencode=arch=compute_89,code=compute_89 -Xcompiler -O2'
includes=()
for d in util AddressUtil CryptoUtil KeyFinderLib CudaKeySearchDevice cudaMath cudaUtil secp256k1lib Logger; do includes+=("-I$src/$d"); done
g++ -O2 -std=c++14 "$here/main.cpp" "${includes[@]}" -I"$cuda/include" -L"$src/lib" -L"$cuda/lib" -L"$cuda/lib64" -Wl,-rpath,'$ORIGIN/lib' -Wl,--start-group -lCudaKeySearchDevice -lkeyfinder -laddressutil -lsecp256k1 -lcryptoutil -lcudautil -llogger -lutil -Wl,--end-group -lcudart -lcudadevrt -o "$out"
sha256sum "$out"
