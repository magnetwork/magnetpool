var util = require('./util.js');


function Transaction(params){
    var version = params.version || 1,
        inputs = params.inputs || [],
        outputs = params.outputs || [],
        lockTime = params.lockTime || 0,
        txTimestamp = util.packUInt32LE(params.curtime);

        // Reference from magnet code.
        // READWRITE(this ->nVersion);
        // READWRITE(nTime);
        // READWRITE(vin);
        // READWRITE(vout);
        // READWRITE(nLockTime);


    this.toBuffer = function(){
        return Buffer.concat([
            util.packUInt32BE(version),
            txTimestamp,
            util.varIntBuffer(inputs.length),
            Buffer.concat(inputs.map(function(i){ return i.toBuffer() })),
            util.varIntBuffer(outputs.length),
            Buffer.concat(outputs.map(function (o) { return o.toBuffer() })),
            util.packUInt32BE(lockTime)
        ]);
    };

    this.inputs = inputs;
    this.outputs = outputs;

}

function TransactionInput(params){
    var prevOutHash = params.prevOutHash || 0,
        prevOutIndex = params.prevOutIndex,
        sigScript = params.sigScript,
        sequence = params.sequence || 0;


    this.toBuffer = function(){
        sigScriptBuffer = sigScript.toBuffer();
        console.log('scriptSig length ' + sigScriptBuffer.length);
        return Buffer.concat([
            util.uint256BufferFromHash(prevOutHash),
            util.packUInt32BE(prevOutIndex),
            util.varIntBuffer(sigScriptBuffer.length),
            sigScriptBuffer,
            util.packUInt32BE(sequence)
        ]);
    };
}

function TransactionOutput(params){
    var value = params.value,
        pkScriptBuffer = params.pkScriptBuffer;

    

    this.toBuffer = function(){
        return Buffer.concat([
            util.packInt64LE(value),
            util.varIntBuffer(pkScriptBuffer.length),
            pkScriptBuffer
        ]);
    };
}

function ScriptSig(params){

    var height = params.height,
        flags = params.flags,
        extraNoncePlaceholder = params.extraNoncePlaceholder;

    this.toBuffer = function(){

        return Buffer.concat([
            util.serializeNumber(height),
            new Buffer(flags, 'hex'),
            util.serializeNumber(Date.now() / 1000 | 0),
            new Buffer([extraNoncePlaceholder.length]),
            extraNoncePlaceholder,
            util.serializeString('/nodeStratum/')
        ]);
    }
};



/*
     ^^^^ The above code was a bit slow. The below code is uglier but optimized.
 */



/*
This function creates the generation transaction that accepts the reward for
successfully mining a new block.
For some (probably outdated and incorrect) documentation about whats kinda going on here,
see: https://en.bitcoin.it/wiki/Protocol_specification#tx
 */

var generateOutputTransactions = function(poolRecipient, recipients, rpcData){
    var reward = rpcData.coinbasevalue;
    var rewardToPool = reward;

    var txOutputBuffers = [];

    /* Dash 12.1 */
    if (rpcData.masternode && rpcData.superblock) {
        if (rpcData.masternode.payee) {
            var payeeReward = 0;

            payeeReward = rpcData.masternode.amount;
            reward -= payeeReward;
            rewardToPool -= payeeReward;

            var payeeScript = util.addressToScript(rpcData.masternode.payee);
            txOutputBuffers.push(Buffer.concat([
                util.packInt64LE(payeeReward),
                util.varIntBuffer(payeeScript.length),
                payeeScript
            ]));
        } else if (rpcData.superblock.length > 0) {
            for(var i in rpcData.superblock){
                var payeeReward = 0;

                payeeReward = rpcData.superblock[i].amount;
                reward -= payeeReward;
                rewardToPool -= payeeReward;

                var payeeScript = util.addressToScript(rpcData.superblock[i].payee);
                txOutputBuffers.push(Buffer.concat([
                    util.packInt64LE(payeeReward),
                    util.varIntBuffer(payeeScript.length),
                    payeeScript
                ]));
            }
        }
    }

    if (rpcData.payee) { 
        var payeeReward = 0;

        if (rpcData.payee_amount) {
            payeeReward = rpcData.payee_amount;
        } else {
            payeeReward = Math.ceil(reward / 2); // 50% to masternodes for magnet.
        }

        reward -= payeeReward;
        rewardToPool -= payeeReward;

        var payeeScript = util.addressToScript(rpcData.payee);
        txOutputBuffers.push(Buffer.concat([
            util.packInt64LE(payeeReward),
            util.varIntBuffer(payeeScript.length),
            payeeScript
        ]));
    }

    // Pool settings will have no effects.
    // Uncomment to enable - untested.
    for (var i = 0; i < recipients.length; i++){
        var recipientReward = Math.floor(recipients[i].percent * reward);
        rewardToPool -= recipientReward;

        txOutputBuffers.push(Buffer.concat([
            util.packInt64LE(recipientReward),
            util.varIntBuffer(recipients[i].script.length),
            recipients[i].script
        ]));
    }

    txOutputBuffers.unshift(Buffer.concat([
        util.packInt64LE(rewardToPool),
        util.varIntBuffer(poolRecipient.length),
        poolRecipient
    ]));

    return Buffer.concat([
        util.varIntBuffer(txOutputBuffers.length),
        Buffer.concat(txOutputBuffers)
    ]);

};


exports.CreateGeneration = function (rpcData, publicKey, extraNoncePlaceholder, reward, txMessages, recipients, auxMerkleTree) {

    // Returns the indexOf val within buf.
    function indexOf(buf, val, byteOffset) {
        var match = -1;
        for (var i = 0; byteOffset + i < buf.length; i++) {
            if (buf[byteOffset + i] === val[match === -1 ? 0 : i - match]) {
                match = match === -1 ? i : match;
                if (i - match + 1 === val.length) {
                    return byteOffset + match;
                }
            } else {
                match = -1;
            }
        }

        return -1;
    }

/*
    // Uncomment to use the former code.
    var tx = new Transaction({
        curtime: rpcData.curtime,
        inputs: [new TransactionInput({
            prevOutIndex: Math.pow(2, 32) - 1,
            sigScript: new ScriptSig({
                height: rpcData.height,
                flags: rpcData.coinbaseaux.flags,
                extraNoncePlaceholder: extraNoncePlaceholder
            })
        })],
        outputs: [new TransactionOutput({
            value: rpcData.coinbasevalue,
            pkScriptBuffer: publicKey
        })]
    });

    var txBuffer = tx.toBuffer();
    var epIndex = indexOf(txBuffer, extraNoncePlaceholder, 0);
    var p1 = txBuffer.slice(0, epIndex);
    var p2 = txBuffer.slice(epIndex + extraNoncePlaceholder.length);

    return [p1, p2];
    */

    var txInputsCount = 1;
    var txOutputsCount = 1;
    var txVersion = 1;
    var txLockTime = 0;

    var txInPrevOutHash = 0;
    var txInPrevOutIndex = Math.pow(2, 32) - 1;
    var txInSequence = 0;

    //Only required for POS coins
    var txTimestamp = util.packUInt32LE(rpcData.curtime);

    var scriptSigPart1 = Buffer.concat([
        util.serializeNumber(rpcData.height),
        new Buffer(rpcData.coinbaseaux.flags, 'hex'),
        util.serializeNumber(Date.now() / 1000 | 0),
        new Buffer([extraNoncePlaceholder.length]),
        new Buffer('fabe6d6d', 'hex'),
        util.reverseBuffer(auxMerkleTree.root),
        util.packUInt32LE(auxMerkleTree.data.length)
    ]);
    var scriptSigPart2 = util.serializeString('/nodeStratum/');

    var p1 = Buffer.concat([
        util.packUInt32LE(txVersion),
        txTimestamp,

        // READWRITE(prevout);
        // READWRITE(scriptSig);
        // READWRITE(nSequence);

        //transaction input
        util.varIntBuffer(txInputsCount),
        util.uint256BufferFromHash(txInPrevOutHash),
        util.packUInt32LE(txInPrevOutIndex),
        util.varIntBuffer(scriptSigPart1.length + extraNoncePlaceholder.length + scriptSigPart2.length),
        scriptSigPart1
        //new Buffer('08', 'hex') // coinbase
        
    ]);



   //The generation transaction must be split at the extranonce (which located in the transaction input
  //  scriptSig). Miners send us unique extranonces that we use to join the two parts in attempt to create
   // a valid share and/or block.



    var outputTransactions = generateOutputTransactions(publicKey, recipients, rpcData);

    var p2 = Buffer.concat([
        scriptSigPart2,
        //util.packUInt32LE(txInSequence),
        util.packUInt32LE(txInPrevOutIndex),
        //end transaction input

        //transaction output
        outputTransactions,
        //end transaction ouput

        util.packUInt32LE(txLockTime)
    ]);

    return [p1, p2];

};
