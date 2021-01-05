const {
    BN,
    expectRevert,
    expectEvent,
    time,
    balance,
} = require('openzeppelin-test-helpers');
const chai = require('chai');
const {expect} = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);
const UnitTestSFC = artifacts.require('UnitTestSFC');
const SFC = artifacts.require('SFC');
const StakersConstants = artifacts.require('StakersConstants');

function amount18(n) {
    return new BN(web3.utils.toWei(n, 'ether'));
}

async function sealEpoch(sfc, duration, _validatorsMetrics = undefined) {
    let validatorsMetrics = _validatorsMetrics;
    const validatorIDs = (await sfc.lastValidatorID()).toNumber();

    if (validatorsMetrics === undefined) {
        validatorsMetrics = {};
        for (let i = 0; i < validatorIDs; i++) {
            validatorsMetrics[i] = {
                offlineTime: new BN('0'),
                offlineBlocks: new BN('0'),
                uptime: duration,
                originatedTxsFee: amount18('0'),
            };
        }
    }
    // unpack validator metrics
    const allValidators = [];
    const offlineTimes = [];
    const offlineBlocks = [];
    const uptimes = [];
    const originatedTxsFees = [];
    for (let i = 0; i < validatorIDs; i++) {
        allValidators.push(i + 1);
        offlineTimes.push(validatorsMetrics[i].offlineTime);
        offlineBlocks.push(validatorsMetrics[i].offlineBlocks);
        uptimes.push(validatorsMetrics[i].uptime);
        originatedTxsFees.push(validatorsMetrics[i].originatedTxsFee);
    }

    await sfc.advanceTime(duration);
    await sfc._sealEpoch(offlineTimes, offlineBlocks, uptimes, originatedTxsFees);
    await sfc._sealEpochValidators(allValidators);
}


class BlockchainNode {
    constructor(sfc, minter) {
        this.validators = {};
        this.nextValidators = {};
        this.sfc = sfc;
        this.minter = minter;
    }

    async handle(tx) {
        for (let i = 0; i < tx.logs.length; i += 1) {
            if (tx.logs[i].event === 'UpdatedValidatorWeight') {
                if (tx.logs[i].args.weight.isZero()) {
                    delete this.nextValidators[tx.logs[i].args.validatorID.toString()];
                } else {
                    this.nextValidators[tx.logs[i].args.validatorID.toString()] = tx.logs[i].args.weight;
                }
            }
            if (tx.logs[i].event === 'IncBalance') {
                if (tx.logs[i].args.acc !== this.sfc.address) {
                    throw 'unexpected IncBalance account';
                }
                await this.sfc.sendTransaction({
                    from: this.minter,
                    value: tx.logs[i].args.value,
                });
            }
        }
    }

    async sealEpoch(duration, _validatorsMetrics = undefined) {
        let validatorsMetrics = _validatorsMetrics;
        const validatorIDs = Object.keys(this.validators);
        const nextValidatorIDs = Object.keys(this.nextValidators);
        if (validatorsMetrics === undefined) {
            validatorsMetrics = {};
            for (let i = 0; i < validatorIDs.length; i += 1) {
                validatorsMetrics[validatorIDs[i].toString()] = {
                    offlineTime: new BN('0'),
                    offlineBlocks: new BN('0'),
                    uptime: duration,
                    originatedTxsFee: amount18('0'),
                };
            }
        }
        // unpack validator metrics
        const offlineTimes = [];
        const offlineBlocks = [];
        const uptimes = [];
        const originatedTxsFees = [];
        for (let i = 0; i < validatorIDs.length; i += 1) {
            offlineTimes.push(validatorsMetrics[validatorIDs[i].toString()].offlineTime);
            offlineBlocks.push(validatorsMetrics[validatorIDs[i].toString()].offlineBlocks);
            uptimes.push(validatorsMetrics[validatorIDs[i].toString()].uptime);
            originatedTxsFees.push(validatorsMetrics[validatorIDs[i].toString()].originatedTxsFee);
        }

        await this.sfc.advanceTime(duration);
        await this.handle(await this.sfc._sealEpoch(offlineTimes, offlineBlocks, uptimes, originatedTxsFees));
        await this.handle(await this.sfc._sealEpochValidators(nextValidatorIDs));
        this.validators = this.nextValidators;
        // clone this.nextValidators
        this.nextValidators = {};
        for (const vid in this.validators) {
            this.nextValidators[vid] = this.validators[vid];
        }
    }
}

const pubkey = '0x00a2941866e485442aa6b17d67d77f8a6c4580bb556894cc1618473eff1e18203d8cce50b563cf4c75e408886079b8f067069442ed52e2ac9e556baa3f8fcc525f';

contract('SFC', async () => {
    describe('Test minSelfStake from StakersConstants', () => {
        it('Should not be possible to call function with modifier NotInitialized if contract is not initialized', async () => {
            this.sfc = await StakersConstants.new();
            expect((await this.sfc.minSelfStake()).toString()).to.equals('3175000000000000000000000');
        });
    });
});

contract('SFC', async ([account1]) => {
    beforeEach(async () => {
        this.sfc = await SFC.new();
    });

    describe('Test initializable', () => {
        it('Should be possible to call function with modifier NotInitialized if contract is not initialized', async () => {
            await expect(this.sfc._setGenesisValidator(account1, 1, pubkey, 0, await this.sfc.currentEpoch(), Date.now(), 0, 0)).to.be.fulfilled;
        });
    });


    describe('Genesis Validator', () => {
        beforeEach(async () => {
            await expect(this.sfc._setGenesisValidator(account1, 1, pubkey, 1 << 3, await this.sfc.currentEpoch(), Date.now(), 0, 0)).to.be.fulfilled;
        });


        it('Set Genesis Validator with bad Status', async () => {
            await expect(this.sfc._syncValidator(1)).to.be.fulfilled;
        });

        it('should reject sealEpoch if not called by Node', async () => {
            await expect(this.sfc._sealEpoch([1], [1], [1], [1], {
                from: account1,
            })).to.be.rejectedWith('Returned error: VM Exception while processing transaction: revert not callable -- Reason given: not callable.');
        });

        it('should reject SealEpochValidators if not called by Node', async () => {
            await expect(this.sfc._sealEpochValidators([1], {
                from: account1,
            })).to.be.rejectedWith('Returned error: VM Exception while processing transaction: revert not callable -- Reason given: not callable.');
        });
    });
});

contract('SFC', async ([firstValidator, secondValidator, thirdValidator]) => {
    beforeEach(async () => {
        this.sfc = await UnitTestSFC.new();
        await this.sfc.initialize(0);
        await this.sfc.rebaseTime();
        this.node = new BlockchainNode(this.sfc, firstValidator);
    });

    describe('Basic functions', () => {
        describe('Constants', () => {
            it('Returns current Epoch', async () => {
                expect((await this.sfc.currentEpoch()).toString()).to.equals('1');
            });

            it('Returns minimum amount to stake for a Validator', async () => {
                expect((await this.sfc.minSelfStake()).toString()).to.equals('317500000000000000');
            });

            it('Returns the maximum ratio of delegations a validator can have', async () => {
                expect((await this.sfc.maxDelegatedRatio()).toString()).to.equals('16000000000000000000');
            });

            it('Returns commission fee in percentage a validator will get from a delegation', async () => {
                expect((await this.sfc.validatorCommission()).toString()).to.equals('150000000000000000');
            });

            it('Returns commission fee in percentage a validator will get from a contract', async () => {
                expect((await this.sfc.contractCommission()).toString()).to.equals('300000000000000000');
            });

            it('Returns the ratio of the reward rate at base rate (without lockup)', async () => {
                expect((await this.sfc.unlockedRewardRatio()).toString()).to.equals('300000000000000000');
            });

            it('Returns the minimum duration of a stake/delegation lockup', async () => {
                expect((await this.sfc.minLockupDuration()).toString()).to.equals('1209600');
            });

            it('Returns the maximum duration of a stake/delegation lockup', async () => {
                expect((await this.sfc.maxLockupDuration()).toString()).to.equals('31536000');
            });

            it('Returns the period of time that stake is locked', async () => {
                expect((await this.sfc.stakeLockPeriodTime()).toString()).to.equals('604800');
            });

            it('Returns the number of epochs that stake is locked', async () => {
                expect((await this.sfc.unstakePeriodEpochs()).toString()).to.equals('3');
            });

            it('Returns the period of time that stake is locked', async () => {
                expect((await this.sfc.stakeLockPeriodTime()).toString()).to.equals('604800');
            });

            it('Returns the number of Time that stake is locked', async () => {
                expect((await this.sfc.unstakePeriodTime()).toString()).to.equals('604800');
            });

            it('Returns the number of epochs to lock a delegation', async () => {
                expect((await this.sfc.delegationLockPeriodEpochs()).toString()).to.equals('3');
            });

            it('Returns the version of the current implementation', async () => {
                expect((await this.sfc.version()).toString()).to.equals('0x323032');
            });

            it('Should create a Validator and return the ID', async () => {
                await this.sfc.createValidator(pubkey, {
                    from: secondValidator,
                    value: amount18('10'),
                });
                const lastValidatorID = await this.sfc.lastValidatorID();

                expect(lastValidatorID.toString()).to.equals('1');
            });

            it('Should create two Validators and return the correct last validator ID', async () => {
                let lastValidatorID;
                await this.sfc.createValidator(pubkey, {
                    from: secondValidator,
                    value: amount18('10'),
                });
                lastValidatorID = await this.sfc.lastValidatorID();

                expect(lastValidatorID.toString()).to.equals('1');

                await this.sfc.createValidator(pubkey, {
                    from: thirdValidator,
                    value: amount18('12'),
                });
                lastValidatorID = await this.sfc.lastValidatorID();
                expect(lastValidatorID.toString()).to.equals('2');
            });

            it('Should return Delegation', async () => {
                await this.sfc.createValidator(pubkey, {
                    from: secondValidator,
                    value: amount18('10'),
                });
                (await this.sfc.stake(1, { from: secondValidator, value: 1 }));
            });

            it('Should reject if amount is insufficient for self-stake', async () => {
                expect((await this.sfc.minSelfStake()).toString()).to.equals('317500000000000000');
                await expect(this.sfc.createValidator(pubkey, {
                    from: secondValidator,
                    value: amount18('0.3'),
                })).to.be.rejectedWith('Returned error: VM Exception while processing transaction: revert insufficient self-stake -- Reason given: insufficient self-stake.');
            });

            it('Returns current Epoch', async () => {
                expect((await this.sfc.currentEpoch()).toString()).to.equals('1');
            });

            it('Should return current Sealed Epoch', async () => {
                expect((await this.sfc.currentSealedEpoch()).toString()).to.equals('0');
            });

            it('Should return Now()', async () => {
                const now = Math.trunc((Date.now()) / 1000);
                expect((await this.sfc.getBlockTime()).toNumber()).to.be.within(now - 10, now + 10);
            });
        });

        describe('Initialize', () => {
            it('Should have been initialized with firstValidator', async () => {
                expect(await this.sfc.owner()).to.equals(firstValidator);
            });
        });

        describe('Ownable', () => {
            it('Should return the owner of the contract', async () => {
                expect(await this.sfc.owner()).to.equals(firstValidator);
            });

            it('Should return true if the caller is the owner of the contract', async () => {
                expect(await this.sfc.isOwner()).to.equals(true);
                expect(await this.sfc.isOwner({ from: thirdValidator })).to.equals(false);
            });


            it('Should return address(0) if owner leaves the contract without owner', async () => {
                expect(await this.sfc.owner()).to.equals(firstValidator);
                expect(await this.sfc.renounceOwnership());
                expect(await this.sfc.owner()).to.equals('0x0000000000000000000000000000000000000000');
            });

            it('Should transfer ownership to the new owner', async () => {
                expect(await this.sfc.owner()).to.equals(firstValidator);
                expect(await this.sfc.transferOwnership(secondValidator));
                expect(await this.sfc.owner()).to.equals(secondValidator);
            });

            it('Should not be able to transfer ownership if not owner', async () => {
                await expect(this.sfc.transferOwnership(secondValidator, { from: secondValidator })).to.be.rejectedWith(Error);
            });

            it('Should not be able to transfer ownership to address(0)', async () => {
                await expect(this.sfc.transferOwnership('0x0000000000000000000000000000000000000000')).to.be.rejectedWith(Error);
            });
        });

        describe('Events emitters', () => {
            it('Should call updateGasPowerallocationRate', async () => {
                await this.sfc._updateGasPowerAllocationRate(1, 10);
            });

            it('Should call updateOfflinePenaltyThreshold', async () => {
                await this.sfc._updateOfflinePenaltyThreshold(1, 10);
            });

            it('Should call updateMinGasPrice', async () => {
                await this.sfc._updateMinGasPrice(10);
            });
        });
    });
});

contract('SFC', async ([firstValidator, secondValidator, thirdValidator, firstDelegator, secondDelegator, thirdDelegator]) => {
    beforeEach(async () => {
        this.sfc = await UnitTestSFC.new();
        await this.sfc.initialize(10);
        await this.sfc.rebaseTime();
        this.node = new BlockchainNode(this.sfc, firstValidator);
    });

    describe('Prevent Genesis Call if not Initialized', () => {
        it('Should not be possible add a Genesis Validator if contract has been initialized', async () => {
            await expect(this.sfc._setGenesisValidator(secondValidator, 1, pubkey, 0, await this.sfc.currentEpoch(), Date.now(), 0, 0)).to.be.rejectedWith('Returned error: VM Exception while processing transaction: revert Contract instance has already been initialized -- Reason given: Contract instance has already been initialized.');
        });

        it('Should not be possible add a Genesis Delegation if contract has been initialized', async () => {
            await expect(this.sfc._setGenesisDelegation(firstDelegator, 1, 100, 1000)).to.be.rejectedWith('Returned error: VM Exception while processing transaction: revert Contract instance has already been initialized -- Reason given: Contract instance has already been initialized.');
        });
    });

    describe('Create validators', () => {
        it('Should create Validators', async () => {
            await expect(this.sfc.createValidator(pubkey, {
                from: firstValidator,
                value: amount18('10'),
            })).to.be.fulfilled;
            await expect(this.sfc.createValidator(pubkey, {
                from: secondValidator,
                value: amount18('15'),
            })).to.be.fulfilled;
            await expect(this.sfc.createValidator(pubkey, {
                from: thirdValidator,
                value: amount18('20'),
            })).to.be.fulfilled;
        });

        it('Should return the right ValidatorID by calling getValidatorID', async () => {
            expect((await this.sfc.getValidatorID(firstValidator)).toString()).to.equals('0');
            expect((await this.sfc.getValidatorID(secondValidator)).toString()).to.equals('0');
            await expect(this.sfc.createValidator(pubkey, {
                from: firstValidator,
                value: amount18('10'),
            })).to.be.fulfilled;
            expect((await this.sfc.getValidatorID(firstValidator)).toString()).to.equals('1');
            await expect(this.sfc.createValidator(pubkey, {
                from: secondValidator,
                value: amount18('15'),
            })).to.be.fulfilled;
            expect((await this.sfc.getValidatorID(secondValidator)).toString()).to.equals('2');
            await expect(this.sfc.createValidator(pubkey, {
                from: thirdValidator,
                value: amount18('20'),
            })).to.be.fulfilled;
            expect((await this.sfc.getValidatorID(thirdValidator)).toString()).to.equals('3');
        });

        it('Should not be able to stake if Validator not created yet', async () => {
            await expect(this.sfc.stake(1, {
                from: firstDelegator,
                value: amount18('10'),
            })).to.be.rejectedWith('Returned error: VM Exception while processing transaction: revert validator doesn\'t exist -- Reason given: validator doesn\'t exist');
            await expect(this.sfc.createValidator(pubkey, {
                from: firstValidator,
                value: amount18('10'),
            })).to.be.fulfilled;

            await expect(this.sfc.stake(2, {
                from: secondDelegator,
                value: amount18('10'),
            })).to.be.rejectedWith('Returned error: VM Exception while processing transaction: revert validator doesn\'t exist -- Reason given: validator doesn\'t exist');
            await expect(this.sfc.createValidator(pubkey, {
                from: secondValidator,
                value: amount18('15'),
            })).to.be.fulfilled;

            await expect(this.sfc.stake(3, {
                from: thirdDelegator,
                value: amount18('10'),
            })).to.be.rejectedWith('Returned error: VM Exception while processing transaction: revert validator doesn\'t exist -- Reason given: validator doesn\'t exist');
            await expect(this.sfc.createValidator(pubkey, {
                from: thirdValidator,
                value: amount18('20'),
            })).to.be.fulfilled;
        });

        it('Should stake with different delegators', async () => {
            await expect(this.sfc.createValidator(pubkey, {
                from: firstValidator,
                value: amount18('10'),
            })).to.be.fulfilled;
            expect(await this.sfc.stake(1, { from: firstDelegator, value: amount18('11') }));

            await expect(this.sfc.createValidator(pubkey, {
                from: secondValidator,
                value: amount18('15'),
            })).to.be.fulfilled;
            expect(await this.sfc.stake(2, { from: secondDelegator, value: amount18('10') }));

            await expect(this.sfc.createValidator(pubkey, {
                from: thirdValidator,
                value: amount18('20'),
            })).to.be.fulfilled;
            expect(await this.sfc.stake(3, { from: thirdDelegator, value: amount18('10') }));
            expect(await this.sfc.stake(1, { from: firstDelegator, value: amount18('10') }));
        });

        it('Should return the amount of delegated for each Delegator', async () => {
            await expect(this.sfc.createValidator(pubkey, {
                from: firstValidator,
                value: amount18('10'),
            })).to.be.fulfilled;
            await this.sfc.stake(1, { from: firstDelegator, value: amount18('11') });
            expect((await this.sfc.getStake(firstDelegator, await this.sfc.getValidatorID(firstValidator))).toString()).to.equals('11000000000000000000');

            await expect(this.sfc.createValidator(pubkey, {
                from: secondValidator,
                value: amount18('15'),
            })).to.be.fulfilled;
            await this.sfc.stake(2, { from: secondDelegator, value: amount18('10') });
            expect((await this.sfc.getStake(secondDelegator, await this.sfc.getValidatorID(firstValidator))).toString()).to.equals('0');
            expect((await this.sfc.getStake(secondDelegator, await this.sfc.getValidatorID(secondValidator))).toString()).to.equals('10000000000000000000');


            await expect(this.sfc.createValidator(pubkey, {
                from: thirdValidator,
                value: amount18('12'),
            })).to.be.fulfilled;
            await this.sfc.stake(3, { from: thirdDelegator, value: amount18('10') });
            expect((await this.sfc.getStake(thirdDelegator, await this.sfc.getValidatorID(thirdValidator))).toString()).to.equals('10000000000000000000');

            await this.sfc.stake(3, { from: firstDelegator, value: amount18('10') });

            expect((await this.sfc.getStake(thirdDelegator, await this.sfc.getValidatorID(firstValidator))).toString()).to.equals('0');
            expect((await this.sfc.getStake(firstDelegator, await this.sfc.getValidatorID(thirdValidator))).toString()).to.equals('10000000000000000000');
            await this.sfc.stake(3, { from: firstDelegator, value: amount18('1') });
            expect((await this.sfc.getStake(firstDelegator, await this.sfc.getValidatorID(thirdValidator))).toString()).to.equals('11000000000000000000');
        });

        it('Should return the total of received Stake', async () => {
            await expect(this.sfc.createValidator(pubkey, {
                from: firstValidator,
                value: amount18('10'),
            })).to.be.fulfilled;
            await this.sfc.stake(1, { from: firstDelegator, value: amount18('11') });
            await this.sfc.stake(1, { from: secondDelegator, value: amount18('8') });
            await this.sfc.stake(1, { from: thirdDelegator, value: amount18('8') });
            const validator = await this.sfc.getValidator(1);

            expect(validator.receivedStake.toString()).to.equals('37000000000000000000');
        });

        it('Should return the total of received Stake', async () => {
            await expect(this.sfc.createValidator(pubkey, {
                from: firstValidator,
                value: amount18('10'),
            })).to.be.fulfilled;
            await this.sfc.stake(1, { from: firstDelegator, value: amount18('11') });
            await this.sfc.stake(1, { from: secondDelegator, value: amount18('8') });
            await this.sfc.stake(1, { from: thirdDelegator, value: amount18('8') });
            const validator = await this.sfc.getValidator(1);

            expect(validator.receivedStake.toString()).to.equals('37000000000000000000');
        });
    });
});

contract('SFC', async ([firstValidator, secondValidator, thirdValidator, firstDelegator, secondDelegator, thirdDelegator]) => {
    beforeEach(async () => {
        this.sfc = await UnitTestSFC.new();
        await this.sfc.initialize(10);
        await this.sfc.rebaseTime();
        this.node = new BlockchainNode(this.sfc, firstValidator);
    });
    describe('Returns Validator', () => {
        let validator;
        beforeEach(async () => {
            this.sfc = await UnitTestSFC.new();
            await this.sfc.initialize(12);
            await this.sfc.rebaseTime();
            this.node = new BlockchainNode(this.sfc, firstValidator);
            await expect(this.sfc.createValidator(pubkey, { from: firstValidator, value: amount18('10') })).to.be.fulfilled;
            await this.sfc.stake(1, { from: firstDelegator, value: amount18('11') });
            await this.sfc.stake(1, { from: secondDelegator, value: amount18('8') });
            await this.sfc.stake(1, { from: thirdDelegator, value: amount18('8') });
            validator = await this.sfc.getValidator(1);
        });

        it('Should returns Validator\' status ', async () => {
            expect(validator.status.toString()).to.equals('0');
        });

        it('Should returns Validator\' Deactivated Time', async () => {
            expect(validator.deactivatedTime.toString()).to.equals('0');
        });

        it('Should returns Validator\' Deactivated Epoch', async () => {
            expect(validator.deactivatedEpoch.toString()).to.equals('0');
        });

        it('Should returns Validator\'s Received Stake', async () => {
            expect(validator.receivedStake.toString()).to.equals('37000000000000000000');
        });

        it('Should returns Validator\'s Created Epoch', async () => {
            expect(validator.createdEpoch.toString()).to.equals('13');
        });

        it('Should returns Validator\'s Created Time', async () => {
            const now = Math.trunc((Date.now()) / 1000);
            expect(validator.createdTime.toNumber()).to.be.within(now - 2, now + 2);
        });

        it('Should returns Validator\'s Auth (address)', async () => {
            expect(validator.auth.toString()).to.equals(firstValidator);
        });
    });

    describe('EpochSnapshot', () => {
        let validator;
        beforeEach(async () => {
            this.sfc = await UnitTestSFC.new();
            await this.sfc.initialize(12);
            await this.sfc.rebaseTime();
            this.node = new BlockchainNode(this.sfc, firstValidator);
            await expect(this.sfc.createValidator(pubkey, { from: firstValidator, value: amount18('10') })).to.be.fulfilled;
            await this.sfc.stake(1, { from: firstDelegator, value: amount18('11') });
            await this.sfc.stake(1, { from: secondDelegator, value: amount18('8') });
            await this.sfc.stake(1, { from: thirdDelegator, value: amount18('8') });
            validator = await this.sfc.getValidator(1);
        });

        it('Returns claimedRewardUntilEpoch', async () => {
            expect(await this.sfc.currentSealedEpoch.call()).to.be.bignumber.equal(new BN('12'));
            expect(await this.sfc.currentEpoch.call()).to.be.bignumber.equal(new BN('13'));
            await this.sfc._sealEpoch([100, 101, 102], [100, 101, 102], [100, 101, 102], [100, 101, 102]);
            expect(await this.sfc.currentSealedEpoch.call()).to.be.bignumber.equal(new BN('13'));
            expect(await this.sfc.currentEpoch.call()).to.be.bignumber.equal(new BN('14'));
            await this.sfc._sealEpoch(
                [100, 101, 102],
                [100, 101, 102],
                [100, 101, 102],
                [100, 101, 102],
            );
            await this.sfc._sealEpoch(
                [100, 101, 102],
                [100, 101, 102],
                [100, 101, 102],
                [100, 101, 102],
            );
            await this.sfc._sealEpoch(
                [100, 101, 102],
                [100, 101, 102],
                [100, 101, 102],
                [100, 101, 102],
            );
            await this.sfc._sealEpoch(
                [100, 101, 102],
                [100, 101, 102],
                [100, 101, 102],
                [100, 101, 102],
            );
            expect(await this.sfc.currentSealedEpoch.call()).to.be.bignumber.equal(new BN('17'));
            expect(await this.sfc.currentEpoch.call()).to.be.bignumber.equal(new BN('18'));
        });
    });
    describe('Methods tests', async () => {
        it('checking createValidator function', async () => {
            expect(await this.sfc.lastValidatorID.call()).to.be.bignumber.equal(new BN('0'));
            await expectRevert(this.sfc.createValidator(pubkey, {
                from: firstValidator,
                value: amount18('0.3175')
                    .sub(new BN(1)),
            }), 'insufficient self-stake');
            await this.node.handle(await this.sfc.createValidator(pubkey, {
                from: firstValidator,
                value: amount18('0.3175'),
            }));
            await expectRevert(this.sfc.createValidator(pubkey, {
                from: firstValidator,
                value: amount18('0.3175'),
            }), 'validator already exists');
            await this.node.handle(await this.sfc.createValidator(pubkey, {
                from: secondValidator,
                value: amount18('0.5'),
            }));

            expect(await this.sfc.lastValidatorID.call()).to.be.bignumber.equal(new BN('2'));
            expect(await this.sfc.totalStake.call()).to.be.bignumber.equal(amount18('0.8175'));

            const firstValidatorID = await this.sfc.getValidatorID(firstValidator);
            const secondValidatorID = await this.sfc.getValidatorID(secondValidator);
            expect(firstValidatorID).to.be.bignumber.equal(new BN('1'));
            expect(secondValidatorID).to.be.bignumber.equal(new BN('2'));

            expect(await this.sfc.getValidatorPubkey(firstValidatorID)).to.equal(pubkey);
            expect(await this.sfc.getValidatorPubkey(secondValidatorID)).to.equal(pubkey);

            const firstValidatorObj = await this.sfc.getValidator.call(firstValidatorID);
            const secondValidatorObj = await this.sfc.getValidator.call(secondValidatorID);

            // check first validator object
            expect(firstValidatorObj.receivedStake).to.be.bignumber.equal(amount18('0.3175'));
            expect(firstValidatorObj.createdEpoch).to.be.bignumber.equal(new BN('11'));
            expect(firstValidatorObj.auth).to.equal(firstValidator);
            expect(firstValidatorObj.status).to.be.bignumber.equal(new BN('0'));
            expect(firstValidatorObj.deactivatedTime).to.be.bignumber.equal(new BN('0'));
            expect(firstValidatorObj.deactivatedEpoch).to.be.bignumber.equal(new BN('0'));

            // check second validator object
            expect(secondValidatorObj.receivedStake).to.be.bignumber.equal(amount18('0.5'));
            expect(secondValidatorObj.createdEpoch).to.be.bignumber.equal(new BN('11'));
            expect(secondValidatorObj.auth).to.equal(secondValidator);
            expect(secondValidatorObj.status).to.be.bignumber.equal(new BN('0'));
            expect(secondValidatorObj.deactivatedTime).to.be.bignumber.equal(new BN('0'));
            expect(secondValidatorObj.deactivatedEpoch).to.be.bignumber.equal(new BN('0'));

            // check created delegations
            expect(await this.sfc.getStake.call(firstValidator, firstValidatorID)).to.be.bignumber.equal(amount18('0.3175'));
            expect(await this.sfc.getStake.call(secondValidator, secondValidatorID)).to.be.bignumber.equal(amount18('0.5'));

            // check fired node-related logs
            expect(Object.keys(this.node.nextValidators).length).to.equal(2);
            expect(this.node.nextValidators[firstValidatorID.toString()]).to.be.bignumber.equal(amount18('0.3175'));
            expect(this.node.nextValidators[secondValidatorID.toString()]).to.be.bignumber.equal(amount18('0.5'));
        });

        it('checking sealing epoch', async () => {
            await this.node.handle(await this.sfc.createValidator(pubkey, {
                from: firstValidator,
                value: amount18('0.3175'),
            }));
            await this.node.handle(await this.sfc.createValidator(pubkey, {
                from: secondValidator,
                value: amount18('0.6825'),
            }));

            await this.node.sealEpoch(new BN('100'));

            const firstValidatorID = await this.sfc.getValidatorID(firstValidator);
            const secondValidatorID = await this.sfc.getValidatorID(secondValidator);
            expect(firstValidatorID).to.be.bignumber.equal(new BN('1'));
            expect(secondValidatorID).to.be.bignumber.equal(new BN('2'));

            const firstValidatorObj = await this.sfc.getValidator.call(firstValidatorID);
            const secondValidatorObj = await this.sfc.getValidator.call(secondValidatorID);

            await this.node.handle(await this.sfc.stake(firstValidatorID, {
                from: firstValidator,
                value: amount18('0.1'),
            }));
            await this.node.handle(await this.sfc.createValidator(pubkey, {
                from: thirdValidator,
                value: amount18('0.4'),
            }));
            const thirdValidatorID = await this.sfc.getValidatorID(thirdValidator);

            // check fired node-related logs
            expect(Object.keys(this.node.validators).length).to.equal(2);
            expect(this.node.validators[firstValidatorID.toString()]).to.be.bignumber.equal(amount18('0.3175'));
            expect(this.node.validators[secondValidatorID.toString()]).to.be.bignumber.equal(amount18('0.6825'));
            expect(Object.keys(this.node.nextValidators).length).to.equal(3);
            expect(this.node.nextValidators[firstValidatorID.toString()]).to.be.bignumber.equal(amount18('0.4175'));
            expect(this.node.nextValidators[secondValidatorID.toString()]).to.be.bignumber.equal(amount18('0.6825'));
            expect(this.node.nextValidators[thirdValidatorID.toString()]).to.be.bignumber.equal(amount18('0.4'));
        });
    });
});

contract('SFC', async ([firstValidator, secondValidator, thirdValidator, firstDelegator, secondDelegator]) => {
    let firstValidatorID;
    let secondValidatorID;
    let thirdValidatorID;

    beforeEach(async () => {
        this.sfc = await UnitTestSFC.new();
        await this.sfc.initialize(0);
        await this.sfc.rebaseTime();

        await this.sfc.createValidator(pubkey, {
            from: firstValidator,
            value: amount18('0.4'),
        });
        firstValidatorID = await this.sfc.getValidatorID(firstValidator);

        await this.sfc.createValidator(pubkey, {
            from: secondValidator,
            value: amount18('0.8'),
        });
        secondValidatorID = await this.sfc.getValidatorID(secondValidator);

        await this.sfc.createValidator(pubkey, {
            from: thirdValidator,
            value: amount18('0.8'),
        });
        thirdValidatorID = await this.sfc.getValidatorID(thirdValidator);
        await this.sfc.stake(firstValidatorID, {
            from: firstValidator,
            value: amount18('0.4'),
        });

        await this.sfc.stake(firstValidatorID, {
            from: firstDelegator,
            value: amount18('0.4'),
        });
        await this.sfc.stake(secondValidatorID, {
            from: secondDelegator,
            value: amount18('0.4'),
        });

        await sealEpoch(this.sfc, (new BN(0)).toString());
    });

    describe('Staking / Sealed Epoch functions', () => {
        it('Should return claimed Rewards until Epoch', async () => {
            await this.sfc._updateBaseRewardPerSecond(new BN('1'));
            await sealEpoch(this.sfc, (new BN(60 * 60 * 24)).toString());
            await sealEpoch(this.sfc, (new BN(60 * 60 * 24)).toString());
            expect(await this.sfc.claimedRewardUntilEpoch(firstDelegator, 1)).to.bignumber.equal(new BN(0));
            await this.sfc.claimRewards(1, { from: firstDelegator });
            expect(await this.sfc.claimedRewardUntilEpoch(firstDelegator, 1)).to.bignumber.equal(await this.sfc.currentSealedEpoch());
        });

        it('Check pending Rewards of delegators', async () => {
            await this.sfc._updateBaseRewardPerSecond(new BN('1'));

            expect((await this.sfc.pendingRewards(firstValidator, firstValidatorID)).toString()).to.equals('0');
            expect((await this.sfc.pendingRewards(firstDelegator, firstValidatorID)).toString()).to.equals('0');

            await sealEpoch(this.sfc, (new BN(60 * 60 * 24)).toString());

            expect((await this.sfc.pendingRewards(firstValidator, firstValidatorID)).toString()).to.equals('3523');
            expect((await this.sfc.pendingRewards(firstDelegator, firstValidatorID)).toString()).to.equals('1032');
        });

        it('Check if pending Rewards have been increased after sealing Epoch', async () => {
            await this.sfc._updateBaseRewardPerSecond(new BN('1'));

            await sealEpoch(this.sfc, (new BN(60 * 60 * 24)).toString());
            expect((await this.sfc.pendingRewards(firstValidator, firstValidatorID)).toString()).to.equals('3523');
            expect((await this.sfc.pendingRewards(firstDelegator, firstValidatorID)).toString()).to.equals('1032');

            await sealEpoch(this.sfc, (new BN(60 * 60 * 24)).toString());
            expect((await this.sfc.pendingRewards(firstValidator, firstValidatorID)).toString()).to.equals('7046');
            expect((await this.sfc.pendingRewards(firstDelegator, firstValidatorID)).toString()).to.equals('2065');
        });

        it('Should increase balances after claiming Rewards', async () => {
            await this.sfc._updateBaseRewardPerSecond(new BN('1'));

            await sealEpoch(this.sfc, (new BN(0)).toString());
            await sealEpoch(this.sfc, (new BN(60 * 60 * 24)).toString());

            const firstDelegatorPendingRewards = await this.sfc.pendingRewards(firstDelegator, firstValidatorID);
            const firstDelegatorBalance = await web3.eth.getBalance(firstDelegator);

            await this.sfc.claimRewards(1, { from: firstDelegator });

            expect(new BN(firstDelegatorBalance + firstDelegatorPendingRewards)).to.be.bignumber.above(await web3.eth.getBalance(firstDelegator));
        });

        it('Should return stashed Rewards', async () => {
            await this.sfc._updateBaseRewardPerSecond(new BN('1'));

            await sealEpoch(this.sfc, (new BN(0)).toString());
            await sealEpoch(this.sfc, (new BN(60 * 60 * 24)).toString());

            expect((await this.sfc.rewardsStash(firstDelegator, 1)).toString()).to.equals('0');

            await this.sfc.stashRewards(firstDelegator, 1);
            expect((await this.sfc.rewardsStash(firstDelegator, 1)).toString()).to.equals('1032');
        });

        it('Should update the validator on node', async () => {
            await this.sfc._updateOfflinePenaltyThreshold(1000, 500);
            const tx = (await this.sfc.offlinePenaltyThreshold());

            const offlinePenaltyThresholdBlocksNum = (tx[0]);
            const offlinePenaltyThresholdTime = (tx[1]);
            expect(offlinePenaltyThresholdTime).to.bignumber.equals(new BN(500));
            expect(offlinePenaltyThresholdBlocksNum).to.bignumber.equals(new BN(1000));
        });

        it('Should not be able to deactivate validator if not Node', async () => {
            await expect(this.sfc._deactivateValidator(1, 0)).to.be.rejectedWith('Returned error: VM Exception while processing transaction: revert not callable -- Reason given: not callable.');
        });

        it('Should seal Epochs', async () => {
            let validatorsMetrics;
            const validatorIDs = (await this.sfc.lastValidatorID()).toNumber();

            if (validatorsMetrics === undefined) {
                validatorsMetrics = {};
                for (let i = 0; i < validatorIDs; i++) {
                    validatorsMetrics[i] = {
                        offlineTime: new BN('0'),
                        offlineBlocks: new BN('0'),
                        uptime: new BN(24 * 60 * 60).toString(),
                        originatedTxsFee: amount18('100'),
                    };
                }
            }
            const allValidators = [];
            const offlineTimes = [];
            const offlineBlocks = [];
            const uptimes = [];
            const originatedTxsFees = [];
            for (let i = 0; i < validatorIDs; i++) {
                allValidators.push(i + 1);
                offlineTimes.push(validatorsMetrics[i].offlineTime);
                offlineBlocks.push(validatorsMetrics[i].offlineBlocks);
                uptimes.push(validatorsMetrics[i].uptime);
                originatedTxsFees.push(validatorsMetrics[i].originatedTxsFee);
            }

            await expect(this.sfc.advanceTime(new BN(24 * 60 * 60).toString())).to.be.fulfilled;
            await expect(this.sfc._sealEpoch(offlineTimes, offlineBlocks, uptimes, originatedTxsFees)).to.be.fulfilled;
            await expect(this.sfc._sealEpochValidators(allValidators)).to.be.fulfilled;
        });

        it('Should seal Epoch on Validators', async () => {
            let validatorsMetrics;
            const validatorIDs = (await this.sfc.lastValidatorID()).toNumber();

            if (validatorsMetrics === undefined) {
                validatorsMetrics = {};
                for (let i = 0; i < validatorIDs; i++) {
                    validatorsMetrics[i] = {
                        offlineTime: new BN('0'),
                        offlineBlocks: new BN('0'),
                        uptime: new BN(24 * 60 * 60).toString(),
                        originatedTxsFee: amount18('0'),
                    };
                }
            }
            const allValidators = [];
            const offlineTimes = [];
            const offlineBlocks = [];
            const uptimes = [];
            const originatedTxsFees = [];
            for (let i = 0; i < validatorIDs; i++) {
                allValidators.push(i + 1);
                offlineTimes.push(validatorsMetrics[i].offlineTime);
                offlineBlocks.push(validatorsMetrics[i].offlineBlocks);
                uptimes.push(validatorsMetrics[i].uptime);
                originatedTxsFees.push(validatorsMetrics[i].originatedTxsFee);
            }

            await expect(this.sfc.advanceTime(new BN(24 * 60 * 60).toString())).to.be.fulfilled;
            await expect(this.sfc._sealEpoch(offlineTimes, offlineBlocks, uptimes, originatedTxsFees)).to.be.fulfilled;
            await expect(this.sfc._sealEpochValidators(allValidators)).to.be.fulfilled;
        });
    });

    describe('Stake lockup', () => {
        beforeEach('lock stakes', async () => {
            // Lock 75% of stake for 60% of a maximum lockup period
            // Should receive (0.3 * 0.25 + (0.3 + 0.7 * 0.6) * 0.75) / 0.3 = 2.05 times more rewards
            await this.sfc.lockStake(firstValidatorID, new BN(86400 * 219), amount18('0.6'), {
                from: firstValidator,
            });
            // Lock 25% of stake for 20% of a maximum lockup period
            // Should receive (0.3 * 0.75 + (0.3 + 0.7 * 0.2) * 0.25) / 0.3 = 1.1166 times more rewards
            await this.sfc.lockStake(firstValidatorID, new BN(86400 * 73), amount18('0.1'), {
                from: firstDelegator,
            });
        });

        // note: copied from the non-lockup tests
        it('Check pending Rewards of delegators', async () => {
            await this.sfc._updateBaseRewardPerSecond(new BN('1'));

            expect((await this.sfc.pendingRewards(firstValidator, firstValidatorID)).toString()).to.equals('0');
            expect((await this.sfc.pendingRewards(firstDelegator, firstValidatorID)).toString()).to.equals('0');

            await sealEpoch(this.sfc, (new BN(60 * 60 * 24)).toString());

            expect((await this.sfc.pendingRewards(firstValidator, firstValidatorID)).toString()).to.equals('7221');
            expect((await this.sfc.pendingRewards(firstDelegator, firstValidatorID)).toString()).to.equals('1152');
        });

        // note: copied from the non-lockup tests
        it('Check if pending Rewards have been increased after sealing Epoch', async () => {
            await this.sfc._updateBaseRewardPerSecond(new BN('1'));

            await sealEpoch(this.sfc, (new BN(60 * 60 * 24)).toString());
            expect((await this.sfc.pendingRewards(firstValidator, firstValidatorID)).toString()).to.equals('7221');
            expect((await this.sfc.pendingRewards(firstDelegator, firstValidatorID)).toString()).to.equals('1152');

            await sealEpoch(this.sfc, (new BN(60 * 60 * 24)).toString());
            expect((await this.sfc.pendingRewards(firstValidator, firstValidatorID)).toString()).to.equals('14443');
            expect((await this.sfc.pendingRewards(firstDelegator, firstValidatorID)).toString()).to.equals('2305');
        });

        // note: copied from the non-lockup tests
        it('Should increase balances after claiming Rewards', async () => {
            await this.sfc._updateBaseRewardPerSecond(new BN('1'));

            await sealEpoch(this.sfc, (new BN(0)).toString());
            await sealEpoch(this.sfc, (new BN(60 * 60 * 24)).toString());

            const firstDelegatorPendingRewards = await this.sfc.pendingRewards(firstDelegator, firstValidatorID);
            const firstDelegatorBalance = await web3.eth.getBalance(firstDelegator);

            await this.sfc.claimRewards(1, { from: firstDelegator });

            expect(new BN(firstDelegatorBalance + firstDelegatorPendingRewards)).to.be.bignumber.above(await web3.eth.getBalance(firstDelegator));
        });

        // note: copied from the non-lockup tests
        it('Should return stashed Rewards', async () => {
            await this.sfc._updateBaseRewardPerSecond(new BN('1'));

            await sealEpoch(this.sfc, (new BN(0)).toString());
            await sealEpoch(this.sfc, (new BN(60 * 60 * 24)).toString());

            expect((await this.sfc.rewardsStash(firstDelegator, 1)).toString()).to.equals('0');

            await this.sfc.stashRewards(firstDelegator, 1);
            expect((await this.sfc.rewardsStash(firstDelegator, 1)).toString()).to.equals('1152');
        });

        it('Should return pending rewards after unlocking and re-locking', async () => {
            await this.sfc._updateBaseRewardPerSecond(new BN('1'));

            for (let i = 0; i < 2; i++) {
                const epoch = await this.sfc.currentSealedEpoch();
                // delegator 1 is still locked
                // delegator 1 should receive more rewards than delegator 2
                // validator 1 should receive more rewards than validator 2
                await sealEpoch(this.sfc, (new BN(86400 * (73))).toString());

                expect(await this.sfc.pendingRewards(firstDelegator, 1)).to.be.bignumber.equal(new BN(84185));
                expect(await this.sfc.pendingRewards(secondDelegator, 2)).to.be.bignumber.equal(new BN(75390));
                expect(await this.sfc.pendingRewards(firstValidator, 1)).to.be.bignumber.equal(new BN(527290));
                expect(await this.sfc.pendingRewards(secondValidator, 2)).to.be.bignumber.equal(new BN(257215));

                expect(await this.sfc.highestLockupEpoch(firstDelegator, 1)).to.be.bignumber.equal(epoch.add(new BN(1)));
                expect(await this.sfc.highestLockupEpoch(secondDelegator, 2)).to.be.bignumber.equal(new BN(0));
                expect(await this.sfc.highestLockupEpoch(firstValidator, 1)).to.be.bignumber.equal(epoch.add(new BN(1)));
                expect(await this.sfc.highestLockupEpoch(secondValidator, 2)).to.be.bignumber.equal(new BN(0));

                // delegator 1 isn't locked already
                // delegator 1 should receive the same reward as delegator 2
                // validator 1 should receive more rewards than validator 2
                await sealEpoch(this.sfc, (new BN(86400 * (1))).toString());

                expect(await this.sfc.pendingRewards(firstDelegator, 1)).to.be.bignumber.equal(new BN(84185 + 1032));
                expect(await this.sfc.pendingRewards(secondDelegator, 2)).to.be.bignumber.equal(new BN(75390 + 1033));
                expect(await this.sfc.pendingRewards(firstValidator, 1)).to.be.bignumber.equal(new BN(527290 + 7222));
                expect(await this.sfc.pendingRewards(secondValidator, 2)).to.be.bignumber.equal(new BN(257215 + 3523));
                expect(await this.sfc.highestLockupEpoch(firstDelegator, 1)).to.be.bignumber.equal(epoch.add(new BN(1)));
                expect(await this.sfc.highestLockupEpoch(firstValidator, 1)).to.be.bignumber.equal(epoch.add(new BN(2)));

                // validator 1 is still locked
                // delegator 1 should receive the same reward as delegator 2
                // validator 1 should receive more rewards than validator 2
                await sealEpoch(this.sfc, (new BN(86400 * (145))).toString());

                expect(await this.sfc.pendingRewards(firstDelegator, 1)).to.be.bignumber.equal(new BN(84185 + 1032 + 149749));
                expect(await this.sfc.pendingRewards(secondDelegator, 2)).to.be.bignumber.equal(new BN(75390 + 1033 + 149749));
                expect(await this.sfc.pendingRewards(firstValidator, 1)).to.be.bignumber.equal(new BN(527290 + 7222 + 1047359));
                expect(await this.sfc.pendingRewards(secondValidator, 2)).to.be.bignumber.equal(new BN(257215 + 3523 + 510908));
                expect(await this.sfc.highestLockupEpoch(firstDelegator, 1)).to.be.bignumber.equal(epoch.add(new BN(1)));
                expect(await this.sfc.highestLockupEpoch(firstValidator, 1)).to.be.bignumber.equal(epoch.add(new BN(3)));

                // validator 1 isn't locked already
                // delegator 1 should receive the same reward as delegator 2
                // validator 1 should receive the same reward as validator 2
                await sealEpoch(this.sfc, (new BN(86400 * (1))).toString());

                expect(await this.sfc.pendingRewards(firstDelegator, 1)).to.be.bignumber.equal(new BN(84185 + 1032 + 149749 + 1033));
                expect(await this.sfc.pendingRewards(secondDelegator, 2)).to.be.bignumber.equal(new BN(75390 + 1033 + 149749 + 1032));
                expect(await this.sfc.pendingRewards(firstValidator, 1)).to.be.bignumber.equal(new BN(527290 + 7222 + 1047359 + 3523));
                expect(await this.sfc.pendingRewards(secondValidator, 2)).to.be.bignumber.equal(new BN(257215 + 3523 + 510908 + 3523));
                expect(await this.sfc.highestLockupEpoch(firstDelegator, 1)).to.be.bignumber.equal(epoch.add(new BN(1)));
                expect(await this.sfc.highestLockupEpoch(firstValidator, 1)).to.be.bignumber.equal(epoch.add(new BN(3)));

                // re-lock both validator and delegator
                await this.sfc.lockStake(firstValidatorID, new BN(86400 * 219), amount18('0.6'), {
                    from: firstValidator,
                });
                await this.sfc.lockStake(firstValidatorID, new BN(86400 * 73), amount18('0.1'), {
                    from: firstDelegator,
                });
                // check rewards didn't change after re-locking
                expect(await this.sfc.pendingRewards(firstDelegator, 1)).to.be.bignumber.equal(new BN(84185 + 1032 + 149749 + 1033));
                expect(await this.sfc.pendingRewards(secondDelegator, 2)).to.be.bignumber.equal(new BN(75390 + 1033 + 149749 + 1032));
                expect(await this.sfc.pendingRewards(firstValidator, 1)).to.be.bignumber.equal(new BN(527290 + 7222 + 1047359 + 3523));
                expect(await this.sfc.pendingRewards(secondValidator, 2)).to.be.bignumber.equal(new BN(257215 + 3523 + 510908 + 3523));
                expect(await this.sfc.highestLockupEpoch(firstDelegator, 1)).to.be.bignumber.equal(new BN(0));
                expect(await this.sfc.highestLockupEpoch(firstValidator, 1)).to.be.bignumber.equal(new BN(0));
                // claim rewards to reset pending rewards
                await this.sfc.claimRewards(1, {from: firstDelegator});
                await this.sfc.claimRewards(2, {from: secondDelegator});
                await this.sfc.claimRewards(1, {from: firstValidator});
                await this.sfc.claimRewards(2, {from: secondValidator});
            }
        });
    });
});


contract('SFC', async ([firstValidator, firstDelegator]) => {
    let firstValidatorID;

    beforeEach(async () => {
        this.sfc = await UnitTestSFC.new();
        await this.sfc._setGenesisValidator(firstValidator, 1, pubkey, 0, await this.sfc.currentEpoch(), Date.now(), 0, 0);
        firstValidatorID = await this.sfc.getValidatorID(firstValidator);
        await this.sfc.stake(firstValidatorID, {
            from: firstValidator,
            value: amount18('4'),
        });
        await sealEpoch(this.sfc, new BN(24 * 60 * 60));
    });

    describe('Staking / Sealed Epoch functions', () => {
        it('Should setGenesisDelegation Validator', async () => {
            await this.sfc._setGenesisDelegation(firstDelegator, firstValidatorID, amount18('1'), 100);
            expect(await this.sfc.getStake(firstDelegator, firstValidatorID)).to.bignumber.equals(amount18('1'));
        });
    });
});
