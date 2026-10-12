#include <iostream>
#include <iomanip>
#include <chrono>
#include <set>
#include "CudaKeySearchDevice.h"
#include "AddressUtil.h"
#include "vectors.h"
void resetBenchmarkCounter();
unsigned long long readBenchmarkCounter();
int main(int argc,char**argv){
  try{
    if(argc!=3)throw 1;
    const VectorCase* v=nullptr;
    for(const auto& c:vectors)if(c.id==argv[1]&&c.mode==argv[2])v=&c;
    if(!v)throw 1;
    const auto began=std::chrono::steady_clock::now();
    CudaKeySearchDevice device(0,v->threads,v->points,v->blocks);
    device.init(secp256k1::uint256(static_cast<uint64_t>(v->start)),PointCompressionType::COMPRESSED,secp256k1::uint256(1));
    std::set<KeySearchTarget> targets;
    for(const auto& t:v->targets){KeySearchTarget q;Base58::toHash160(t.address,q.value);targets.insert(q);}
    device.setTargets(targets);resetBenchmarkCounter();
    const auto scanStart=std::chrono::steady_clock::now();
    const auto batch=device.keysPerStep();
    if(!batch||v->count%batch)throw 1;
    std::set<std::string> found;
    for(unsigned long long n=0;n<v->count;n+=batch){
      device.doStep();
      std::vector<KeySearchResult> results;device.getResults(results);
      for(const auto&r:results){
        const std::string a=Address::fromPublicKey(r.publicKey,true);bool expected=false;
        for(const auto&t:v->targets)if(t.address==a&&t.expected){
          const auto scalar=v->start+static_cast<unsigned long long>(t.offset);
          expected=r.compressed&&r.privateKey.cmp(secp256k1::uint256(static_cast<uint64_t>(scalar)))==0;
        }
        if(!expected||!found.insert(a).second)throw 1;
      }
      if(std::chrono::duration<double>(std::chrono::steady_clock::now()-began).count()>180)throw 1;
    }
    const auto scanEnd=std::chrono::steady_clock::now();
    const auto attempted=readBenchmarkCounter();size_t expectedCount=0;
    for(const auto&t:v->targets)if(t.expected){expectedCount++;if(!found.count(t.address))throw 1;}
    if(found.size()!=expectedCount||attempted!=v->count||device.getNextKey().cmp(secp256k1::uint256(static_cast<uint64_t>(v->start+v->count)))!=0)throw 1;
    const double seconds=std::chrono::duration<double>(scanEnd-scanStart).count();
    const double init=std::chrono::duration<double>(scanStart-began).count();
    std::cout<<std::setprecision(12)<<"{\"schema\":\"bithash.gpu-benchmark-case.v1\",\"profile\":\""<<v->id<<"\",\"mode\":\""<<v->mode
      <<"\",\"start\":\""<<v->start<<"\",\"end\":\""<<v->start+v->count<<"\",\"attempted\":\""<<attempted
      <<"\",\"expectedMatches\":"<<expectedCount<<",\"matches\":"<<found.size()<<",\"correct\":true,\"initializationSeconds\":"<<init
      <<",\"scanSeconds\":"<<seconds<<",\"candidatesPerSecond\":"<<attempted/seconds<<"}"<<std::endl;
    return 0;
  }catch(...){std::cerr<<"Fixed synthetic benchmark failed"<<std::endl;return 1;}
}
