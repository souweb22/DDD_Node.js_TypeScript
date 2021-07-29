import PairRepositoryInterface from 'domain/model/pair/PairRepositoryInterface';
import PairFactory from 'domain/factory/PairFactory';
import PairDomainService from 'domain/domainservice/PairDomainService';
import UserRepositoryInterface from 'domain/model/user/UserRepositoryInterface';
import PairDto from './PairDto';
import PairCreateCommand from './PairCreateCommand';
import Pair from 'domain/model/pair/Pair';
import UserId from 'domain/model/user/UserId';


export default class PairApplication {
    private readonly pairRepository: PairRepositoryInterface;
    private readonly pairDomainService: PairDomainService;
    private readonly pairFactory: PairFactory;
    private readonly userRepository: UserRepositoryInterface;

    constructor(pairRepository: PairRepositoryInterface, userRepository: UserRepositoryInterface) {
        this.pairRepository = pairRepository;
        this.userRepository = userRepository;
        this.pairDomainService = new PairDomainService(pairRepository, userRepository);
        this.pairFactory = new PairFactory(this.pairDomainService);
    }

    public async findPairAll() {
        try {
            const pairAggregations = await this.pairRepository.findAll();
            const pairDtos = pairAggregations.map((pairAggregation) => new PairDto(pairAggregation));
            return pairDtos;
        } catch (e) {
            throw new Error(`Error PairApplication::findPairAll(): ${e.message}`);
        }
    }

    public async update(command: PairCreateCommand) {
        try {
            const pair = await this.pairRepository.find(command.id);
            // ユーザーid存在チェック
            if (command.user_ids && !await this.pairDomainService.isExist(command, 'user_ids')) {
                throw new Error(`UserId does not exist. You can not register ${command.user_ids}`);
            }
            const pairRebuild = await this.pairFactory.update(command, pair);

            // ※※※ ペア内ユーザーが減った時(ユーザー2名からユーザー1名)の自動制御および不整合制御 ※※※
            if (pairRebuild.getUserIds().length == Pair.MIN_PAIR_USER && pair.getUserIds().length == Pair.MIN_ACCEPTABLE_PAIR_USER) {
                const pairMinUser = await this.pairRepository.findMinUser(pairRebuild);
                const pairRebuilds = this.pairFactory.move(pairRebuild, pairMinUser);
                await Promise.all(pairRebuilds.map(async (pair) => {
                    await this.pairRepository.update(pair);
                }));
                // 元々ペアにユーザーが2名所属しており、一人にするupdateリクエストで一人にする時に、片方が移動して残りの一名も移動処理
                const pairRebuildforException = await this.pairFactory.update(command, pair); // 例外検出用にpairRebuildと同じオブジェクトを形成
                const excludeUserIds = pair.getUserIds().filter((id) => id != pairRebuildforException.getUserIds()[0]); // 移動しなかった残留のペア内ユーザーidを取得
                pair.changeUserIds(excludeUserIds.map((id) => new UserId(id))); // 残留ユーザーを含むペアへセッター
                // 残留ユーザーが1名の時、不整合が発生するので再度最小構成ユーザー数のペアを探し出し移動する処理を実行
                if (pair.getUserIds().length == Pair.MIN_PAIR_USER) {
                    const pairMinUserForLeft = await this.pairRepository.findMinUser(pair);
                    const pairRebuildsForLeft = this.pairFactory.move(pair, pairMinUserForLeft);
                    await Promise.all(pairRebuildsForLeft.map(async (pair) => {
                        await this.pairRepository.update(pair);
                    }));
                }
                return;
            }
            await this.pairRepository.update(pairRebuild);
        } catch (e) {
            throw new Error(`Error PairApplication::update(): ${e.message}`);
        }
    }
}