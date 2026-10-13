#include <iostream>
#include <string>
#include <vector>
#include "CudaKeySearchDevice.h"
#include "AddressUtil.h"

// Only deliberately public, solved fixtures 1..3. No address or command input.
int main(int argc, char** argv) {
    try {
        if (argc != 4) throw 1;
        const std::string id=argv[1], a=argv[2], b=argv[3];
        if (a.size()!=1 || b.size()!=1 || a[0]<'1' || a[0]>'7' || b[0]<'2' || b[0]>'8') throw 1;
        int start=a[0]-'0', end=b[0]-'0', lower=0, upper=0;
        std::string address;
        if(id=="puzzle-1") {lower=1; upper=2; address="1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH";}
        if(id=="puzzle-2") {lower=2; upper=4; address="1CUNEBjYrCn2y1SdiUMohaKUi4wpP326Lb";}
        if(id=="puzzle-3") {lower=4; upper=8; address="19ZewH8Kk1PDbSNdJ97FP4EiCjTRaZMZQA";}
        if(!upper || start<lower || end>upper || end<=start) throw 1;
        CudaKeySearchDevice device(0,32,1,1);
        device.setFixtureCount(end-start);
        device.init(secp256k1::uint256(start), PointCompressionType::COMPRESSED, secp256k1::uint256(1));
        KeySearchTarget target;
        Base58::toHash160(address, target.value);
        std::set<KeySearchTarget> targets; targets.insert(target); device.setTargets(targets);
        device.doStep();
        std::vector<KeySearchResult> results; device.getResults(results);
        if(results.size()>1) throw 1;
        for(const auto& result:results) {
            if(result.privateKey.cmp(secp256k1::uint256(start))<0 || result.privateKey.cmp(secp256k1::uint256(end))>=0 || !result.compressed || Address::fromPublicKey(result.publicKey,true)!=address) throw 1;
        }
        std::cout << "{\"backend\":\"bitcrack-cuda-bounded-fixture\",\"attempted\":\"" << end-start << "\",\"matched\":" << (results.empty()?"false":"true") << "}" << std::endl;
        return 0;
    } catch (...) {
        std::cerr << "GPU fixture failed" << std::endl;
        return 1;
    }
}
