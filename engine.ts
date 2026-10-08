import { Client, APIGatewayBotInfo } from '@discordjs/core';
import { RequestInit } from 'undici';
import { REST, DefaultRestOptions, ResponseLike } from '@discordjs/rest';
import { WebSocketManager, WebSocketShard } from '@discordjs/ws';
import { GatewaySendPayload, GatewayOpcodes } from 'discord-api-types/v10';
import { randomUUID } from 'node:crypto';

export type Snowflake = string;

export interface QuestApplication {
    id: Snowflake;
    name: string;
    link: string;
}

export interface QuestGradient {
    primary: string;
    secondary: string;
}

export interface QuestMessages {
    quest_name: string;
    game_title: string;
    game_publisher: string;
}

export interface QuestTask {
    event_name: string;
    target: number;
    external_ids?: string[];
    title?: string;
    description?: string;
}

export enum TaskType {
    WATCH_VIDEO = 'WATCH_VIDEO',
    WATCH_VIDEO_ON_MOBILE = 'WATCH_VIDEO_ON_MOBILE',
    WATCH_STREAM = 'WATCH_STREAM',
    PLAY_ON_DESKTOP = 'PLAY_ON_DESKTOP',
    STREAM_ON_DESKTOP = 'STREAM_ON_DESKTOP',
    PLAY_ON_XBOX = 'PLAY_ON_XBOX',
    PLAY_ON_PLAYSTATION = 'PLAY_ON_PLAYSTATION',
    PLAY_ON_NINTENDO = 'PLAY_ON_NINTENDO',
    PLAY_ON_MOBILE = 'PLAY_ON_MOBILE',
    PLAY_ACTIVITY = 'PLAY_ACTIVITY',
    PLAY_SOCIAL_GAME = 'PLAY_SOCIAL_GAME',
    JOIN_COMMUNITY = 'JOIN_COMMUNITY',
    SHARE_CONTENT = 'SHARE_CONTENT',
    FOLLOW_SOCIAL = 'FOLLOW_SOCIAL',
    COMPLETE_SURVEY = 'COMPLETE_SURVEY',
    MAKE_PURCHASE = 'MAKE_PURCHASE',
    REDEEM_CODE = 'REDEEM_CODE',
}

export interface QuestTaskConfig {
    type: number;
    join_operator: string;
    tasks: Record<TaskType, QuestTask>;
    enrollment_url?: string;
    developer_application_id?: Snowflake;
}

export interface QuestTaskConfigV2 {
    join_operator: string;
    tasks: Record<TaskType, QuestTask & { type: string; applications?: { id: string }[] }>;
}

export interface QuestRewardMessages {
    name: string;
    name_with_article: string;
    reward_redemption_instructions_by_platform?: Record<number, string>;
}

export interface QuestReward {
    type: number;
    sku_id: Snowflake;
    asset?: string | null;
    asset_video?: string | null;
    messages: QuestRewardMessages;
    approximate_count?: number | null;
    redemption_link?: string | null;
    expires_at?: string | null;
    orb_quantity?: number;
    quantity?: number;
}

export interface QuestRewardsConfig {
    assignment_method: number;
    rewards: QuestReward[];
    rewards_expire_at: string | null;
    platforms: number;
}

export interface QuestAssets {
    hero: string;
    hero_video: string | null;
    quest_bar_hero: string;
    quest_bar_hero_video: string | null;
    game_tile: string;
    logotype: string;
}

export interface QuestConfig {
    id: Snowflake;
    config_version: number;
    starts_at: string;
    expires_at: string;
    features: number;
    application: QuestApplication;
    assets: QuestAssets;
    colors: QuestGradient;
    messages: QuestMessages;
    task_config?: QuestTaskConfig;
    task_config_v2?: QuestTaskConfigV2;
    rewards_config: QuestRewardsConfig;
}

export interface QuestTaskProgress {
    event_name: string;
    value: number;
    updated_at: string;
    completed_at: string | null;
}

export interface QuestUserStatus {
    user_id: Snowflake;
    quest_id?: Snowflake;
    enrolled_at: string | null;
    completed_at: string | null;
    claimed_at: string | null;
    claimed_tier?: number | null;
    last_stream_heartbeat_at?: string | null;
    stream_progress_seconds?: string;
    dismissed_quest_content?: number;
    progress: Record<string, QuestTaskProgress>;
}

export interface QuestData {
    id: Snowflake;
    config: QuestConfig;
    user_status: QuestUserStatus | null;
    targeted_content: number;
    preview: boolean;
}

export interface QuestsApiResponse {
    quests: QuestData[];
    excluded_quests: Partial<QuestData>[];
    quest_enrollment_blocked_until: string | null;
}

export interface BalanceInfo {
    balance: number;
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9215 Chrome/138.0.7204.251 Electron/37.6.0 Safari/537.36';

const CLIENT_PROPS = {
    os: 'Windows',
    browser: 'Discord Client',
    release_channel: 'stable',
    client_version: '1.0.9215',
    os_version: '10.0.19045',
    os_arch: 'x64',
    app_arch: 'x64',
    system_locale: 'en-US',
    has_client_mods: false,
    client_launch_id: randomUUID(),
    browser_user_agent: USER_AGENT,
    browser_version: '37.6.0',
    os_sdk_version: '19045',
    client_build_number: 471091,
    native_build_number: 72186,
    client_event_source: null,
    launch_signature: randomUUID(),
    client_heartbeat_session_id: randomUUID(),
    client_app_state: 'focused',
};

// Bộ nhớ đệm chặn các token bị lỗi 401 Unauthorized trong phiên chạy để chống spam request
const invalidTokens = new Set<string>();

export class Quest {
    private raw: QuestData;

    private constructor(raw: QuestData) {
        this.raw = raw;
    }

    static from(raw: QuestData): Quest {
        return new Quest(raw);
    }

    get id() { return this.raw.id; }
    get config() { return this.raw.config; }
    get userStatus() { return this.raw.user_status; }
    get preview() { return this.raw.preview; }

    isExpired(now: Date = new Date()): boolean {
        return now.getTime() > new Date(this.raw.config.expires_at).getTime();
    }

    isCompleted(): boolean {
        return Boolean(this.userStatus?.completed_at);
    }

    isEnrolled(): boolean {
        return Boolean(this.userStatus?.enrolled_at);
    }

    isClaimed(): boolean {
        return Boolean(this.userStatus?.claimed_at);
    }

    refreshStatus(status: QuestData['user_status']) {
        this.raw.user_status = status;
    }

    private getTasks(): Record<string, QuestTask> | null {
        return (this.config.task_config_v2?.tasks ?? this.config.task_config?.tasks ?? null) as Record<string, QuestTask> | null;
    }

    detectTaskType(): TaskType | null {
        const tasks = this.getTasks();
        if (!tasks) return null;
        const priority = [
            TaskType.PLAY_ON_DESKTOP,
            TaskType.PLAY_ON_XBOX,
            TaskType.PLAY_ON_PLAYSTATION,
            TaskType.PLAY_ON_NINTENDO,
            TaskType.PLAY_ON_MOBILE,
            TaskType.PLAY_SOCIAL_GAME,
            TaskType.PLAY_ACTIVITY,
            TaskType.STREAM_ON_DESKTOP,
            TaskType.WATCH_STREAM,
            TaskType.WATCH_VIDEO,
            TaskType.WATCH_VIDEO_ON_MOBILE,
            TaskType.FOLLOW_SOCIAL,
            TaskType.SHARE_CONTENT,
            TaskType.JOIN_COMMUNITY,
            TaskType.COMPLETE_SURVEY,
            TaskType.REDEEM_CODE,
            TaskType.MAKE_PURCHASE,
        ];
        return priority.find((t) => tasks[t] != null) ?? null;
    }

    getTarget(): number {
        const taskType = this.detectTaskType();
        if (!taskType) return 900;
        return this.getTasks()?.[taskType]?.target ?? 900;
    }

    getProgress(): number {
        const taskType = this.detectTaskType();
        if (!taskType) return 0;
        return this.userStatus?.progress?.[taskType]?.value ?? 0;
    }

    getRemaining(): number {
        return Math.max(0, this.getTarget() - this.getProgress());
    }

    getRewardLabel(): string {
        const rewards = this.config.rewards_config?.rewards;
        if (!rewards?.length) return 'Unknown';
        if (rewards[0].orb_quantity) return `${rewards[0].orb_quantity} Orbs`;
        return rewards[0].messages?.name ?? 'Unknown';
    }

    get name(): string {
        return this.config.messages.quest_name?.trim() || this.id;
    }
}

async function patchedFetch(url: string, init: RequestInit): Promise<ResponseLike> {
    let rawToken = '';
    if (init.headers) {
        const h = new Headers(init.headers as any);
        if (h.has('User-Agent')) h.set('User-Agent', USER_AGENT);
        if (h.has('Authorization')) {
            rawToken = h.get('Authorization') || '';
            let token = rawToken.replace(/^Bot\s+/i, '').trim();
            h.set('Authorization', token);
            
            // Nếu token đã nằm trong danh sách đen lỗi 401, chặn luôn request xuất phát từ nó
            if (invalidTokens.has(token)) {
                throw new Error('Unauthorized');
            }
        }
        h.append('accept-language', 'vi');
        h.append('origin', 'https://discord.com');
        h.append('pragma', 'no-cache');
        h.append('priority', 'u=1, i');
        h.append('referer', 'https://discord.com/channels/@me');
        h.append('sec-ch-ua', '"Not)A;Brand";v="8", "Chromium";v="138"');
        h.append('sec-ch-ua-mobile', '?0');
        h.append('sec-ch-ua-platform', '"Windows"');
        h.append('sec-fetch-dest', 'empty');
        h.append('sec-fetch-mode', 'cors');
        h.append('sec-fetch-site', 'same-origin');
        h.append('x-debug-options', 'bugReporterEnabled');
        h.append('x-discord-locale', 'en-US');
        h.append('x-discord-timezone', 'Asia/Saigon');
        h.append('x-super-properties', Buffer.from(JSON.stringify(CLIENT_PROPS)).toString('base64'));
        init.headers = h;
    }

    let res = await DefaultRestOptions.makeRequest(url, init);

    // Xử lý tự động khi token bị Unauthorized (401)
    if (res.statusCode === 401) {
        const cleanToken = rawToken.replace(/^Bot\s+/i, '').trim();
        if (cleanToken) invalidTokens.add(cleanToken);
        throw new Error('Unauthorized');
    }

    // Xử lý tự động chờ khi bị dính Rate Limit (429)
    if (res.statusCode === 429) {
        try {
            const bodyText = await res.body.text();
            const data = JSON.parse(bodyText);
            const retryAfter = (data.retry_after || 5) * 1000;
            await new Promise((r) => setTimeout(r, retryAfter));
            return DefaultRestOptions.makeRequest(url, init);
        } catch {
            await new Promise((r) => setTimeout(r, 5000));
            return DefaultRestOptions.makeRequest(url, init);
        }
    }

    return res;
}

const origSend = WebSocketShard.prototype.send;
WebSocketShard.prototype.send = async function (payload: GatewaySendPayload) {
    if (payload.op === GatewayOpcodes.Identify) {
        payload.d = {
            token: payload.d.token,
            properties: { ...CLIENT_PROPS, is_fast_connect: false, gateway_connect_reasons: 'AppSkeleton' },
            capabilities: 0,
            presence: payload.d.presence,
            compress: payload.d.compress,
            client_state: { guild_versions: {} },
        } as any;
    }
    return origSend.call(this, payload);
};

export class HieuTool extends Client {
    public quests: QuestStore | null = null;
    public ws: WebSocketManager;

    constructor(token: string) {
        const cleanToken = token.replace(/^Bot\s+/i, '').trim();
        if (invalidTokens.has(cleanToken)) {
            throw new Error('Unauthorized');
        }
        const rest = new REST({ version: '10', makeRequest: patchedFetch }).setToken(cleanToken);
        const gw = new WebSocketManager({ token: cleanToken, intents: 0, rest });
        gw.fetchGatewayInformation = (): Promise<APIGatewayBotInfo> =>
            Promise.resolve({
                url: 'wss://gateway.discord.gg',
                shards: 1,
                session_start_limit: { total: 1000, remaining: 1000, reset_after: 14400000, max_concurrency: 1 },
            });
        super({ rest, gateway: gw });
        this.ws = gw;
    }

    start() {
        return this.ws.connect();
    }

    async loadQuests(): Promise<QuestStore> {
        const res = await this.rest.get('/quests/@me') as QuestsApiResponse;
        this.quests = new QuestStore(this, res.quests.map((q) => Quest.from(q)));
        return this.quests;
    }

    async getBalance(): Promise<BalanceInfo> {
        return this.rest.get('/users/@me/virtual-currency/balance') as Promise<BalanceInfo>;
    }

    async claimReward(questId: string): Promise<any> {
        return this.rest.post(`/quests/${questId}/claim-reward`, { body: {} });
    }
}

export class QuestStore implements Iterable<Quest> {
    private pool = new Map<string, Quest>();
    private engine: HieuTool;

    constructor(engine: HieuTool, list: Quest[] = []) {
        this.engine = engine;
        list.forEach((q) => this.pool.set(q.id, q));
    }

    [Symbol.iterator](): IterableIterator<Quest> { return this.pool.values(); }
    get count() { return this.pool.size; }
    all(): Quest[] { return Array.from(this.pool.values()); }
    find(id: string) { return this.pool.get(id); }

    pending(): Quest[] {
        return this.all().filter((q) =>
            q.id !== '1412491570820812933' && !q.isCompleted() && !q.isExpired(),
        );
    }

    claimable(): Quest[] {
        return this.all().filter((q) => q.isCompleted() && !q.isClaimed());
    }

    async enroll(questId: string) {
        try {
            const res = await this.engine.rest.post(`/quests/${questId}/enroll`, {
                body: { location: 11, is_targeted: false, metadata_raw: null },
            });
            this.find(questId)?.refreshStatus(res as any);
        } catch (e: any) {
            if (e?.message?.includes('Unauthorized')) return;
        }
    }

    async grabReward(questId: string) {
        try {
            const quest = this.find(questId);
            if (!quest || quest.isClaimed()) return null;
            const r = await this.engine.claimReward(questId);
            return r;
        } catch {
            return null;
        }
    }

    async grabAllRewards() {
        for (const q of this.claimable()) {
            if (q.isClaimed()) continue;
            await this.grabReward(q.id);
            await this.sleep(3000);
        }
    }

    private sleep(ms: number) {
        return new Promise((r) => setTimeout(r, ms));
    }

    async execute(quest: Quest) {
        if (quest.isCompleted() && quest.isClaimed()) return;

        const taskType = quest.detectTaskType();
        if (!taskType) return;

        try {
            if (!quest.isEnrolled()) {
                await this.enroll(quest.id);
                await this.sleep(2000);
            }

            const target = quest.getTarget();
            let done = quest.getProgress();

            if (taskType === TaskType.WATCH_VIDEO || taskType === TaskType.WATCH_VIDEO_ON_MOBILE) {
                await this.executeVideoWatch(quest, taskType, target, done);
            } else if (taskType === TaskType.PLAY_ON_DESKTOP || taskType === TaskType.STREAM_ON_DESKTOP) {
                await this.executeDesktopGameplay(quest, taskType);
            } else if (taskType === TaskType.PLAY_ON_XBOX || taskType === TaskType.PLAY_ON_PLAYSTATION || taskType === TaskType.PLAY_ON_NINTENDO) {
                await this.executeConsoleGameplay(quest, taskType);
            } else if (taskType === TaskType.PLAY_ON_MOBILE || taskType === TaskType.PLAY_SOCIAL_GAME || taskType === TaskType.PLAY_ACTIVITY) {
                await this.executeMobileGameplay(quest, taskType);
            } else if (taskType === TaskType.WATCH_STREAM) {
                await this.executeStreamWatch(quest);
            } else if (taskType === TaskType.FOLLOW_SOCIAL) {
                await this.executeSocialFollow(quest);
            } else if (taskType === TaskType.SHARE_CONTENT) {
                await this.executeShareContent(quest);
            } else if (taskType === TaskType.JOIN_COMMUNITY) {
                await this.executeJoinCommunity(quest);
            } else {
                await this.executeGenericProgress(quest);
            }

            await this.sleep(2000);
            if (!quest.isClaimed()) {
                await this.grabReward(quest.id);
            }
        } catch (e: any) {
            if (e?.message?.includes('Unauthorized')) {
                return; // Bỏ qua mượt mà, không quăng lỗi hay spam log nữa
            }
        }
    }

    private async executeVideoWatch(quest: Quest, taskType: TaskType, target: number, done: number) {
        const enrolledAt = new Date(quest.userStatus?.enrolled_at as any).getTime();
        let finished = false;

        while (done < target) {
            const maxAllowed = Math.floor((Date.now() - enrolledAt) / 1000) + 10;
            const diff = maxAllowed - done;
            const next = Math.min(target, done + 7);

            if (diff >= 7) {
                try {
                    const res = (await this.engine.rest.post(`/quests/${quest.id}/video-progress`, {
                        body: { timestamp: next + Math.random() },
                    })) as any;
                    finished = res.completed_at != null;
                    done = next;
                    if (finished) break;
                } catch (e: any) {
                    if (e?.message?.includes('Unauthorized')) break;
                    break;
                }
            }

            if (next >= target) break;
            await this.sleep(1000);
        }

        if (!finished) {
            try {
                await this.engine.rest.post(`/quests/${quest.id}/video-progress`, {
                    body: { timestamp: target },
                });
            } catch {}
        }
    }

    private async executeDesktopGameplay(quest: Quest, taskType: TaskType) {
        const tasks = quest.config.task_config_v2?.tasks ?? quest.config.task_config?.tasks;
        const taskDef = tasks?.[taskType] as any;
        const appId = taskDef?.applications?.[0]?.id ?? quest.config.application.id;
        
        let attempts = 0;
        while (!quest.isCompleted() && attempts < 120) {
            try {
                const res = await this.engine.rest.post(`/quests/${quest.id}/heartbeat`, {
                    body: { application_id: appId, terminal: false },
                });
                quest.refreshStatus(res as any);
            } catch (e: any) {
                if (e?.message?.includes('Unauthorized')) break;
            }
            attempts++;
            await this.sleep(60_000);
        }
        
        try {
            await this.engine.rest.post(`/quests/${quest.id}/heartbeat`, {
                body: { application_id: appId, terminal: true },
            });
        } catch {}
    }

    private async executeConsoleGameplay(quest: Quest, taskType: TaskType) {
        const tasks = quest.config.task_config_v2?.tasks ?? quest.config.task_config?.tasks;
        const taskDef = tasks?.[taskType] as any;
        const appId = taskDef?.applications?.[0]?.id ?? quest.config.application.id;
        
        let attempts = 0;
        while (!quest.isCompleted() && attempts < 120) {
            const res = await this.engine.rest.post(`/quests/${quest.id}/console-heartbeat`, {
                body: { application_id: appId, platform: taskType.replace('PLAY_ON_', ''), terminal: false },
            }).catch(() => null);
            
            if (res) {
                quest.refreshStatus(res as any);
            }
            attempts++;
            await this.sleep(60_000);
        }
        
        await this.engine.rest.post(`/quests/${quest.id}/console-heartbeat`, {
            body: { application_id: appId, platform: taskType.replace('PLAY_ON_', ''), terminal: true },
        }).catch(() => null);
    }

    private async executeStreamWatch(quest: Quest) {
        const enrolledAt = new Date(quest.userStatus?.enrolled_at as any).getTime();
        const target = quest.getTarget();
        let done = quest.getProgress();

        while (done < target) {
            const elapsed = Math.floor((Date.now() - enrolledAt) / 1000);
            const next = Math.min(done + 30, target);

            const res = (await this.engine.rest.post(`/quests/${quest.id}/stream-progress`, {
                body: { timestamp: next, elapsed },
            })).catch(() => null) as any;

            if (res) {
                done = Math.min(target, next);
                if (res.completed_at) break;
            }
            await this.sleep(30_000);
        }
    }

    private async executeMobileGameplay(quest: Quest, taskType: TaskType) {
        const tasks = quest.config.task_config_v2?.tasks ?? quest.config.task_config?.tasks;
        const taskDef = tasks?.[taskType] as any;
        const appId = taskDef?.applications?.[0]?.id ?? quest.config.application.id;

        let attempts = 0;
        while (!quest.isCompleted() && attempts < 120) {
            const res = await this.engine.rest.post(`/quests/${quest.id}/mobile-heartbeat`, {
                body: { application_id: appId, session_id: randomUUID() },
            }).catch(() => null);

            if (res) {
                quest.refreshStatus(res as any);
            }
            attempts++;
            await this.sleep(45_000);
        }
    }

    private async executeSocialFollow(quest: Quest) {
        const res = await this.engine.rest.post(`/quests/${quest.id}/social-action`, {
            body: { action: 'follow', platform: 'social' },
        }).catch(() => null);

        if (res) {
            quest.refreshStatus(res as any);
        }
    }

    private async executeShareContent(quest: Quest) {
        const res = await this.engine.rest.post(`/quests/${quest.id}/social-action`, {
            body: { action: 'share', platform: 'social' },
        }).catch(() => null);

        if (res) {
            quest.refreshStatus(res as any);
        }
    }

    private async executeJoinCommunity(quest: Quest) {
        const res = await this.engine.rest.post(`/quests/${quest.id}/social-action`, {
            body: { action: 'join', platform: 'community' },
        }).catch(() => null);

        if (res) {
            quest.refreshStatus(res as any);
        }
    }

    private async executeGenericProgress(quest: Quest) {
        let attempts = 0;
        const maxAttempts = 100;

        while (!quest.isCompleted() && attempts < maxAttempts) {
            const res = await this.engine.rest.get(`/quests/${quest.id}/progress`).catch(() => null);
            
            if (res) {
                quest.refreshStatus(res as any);
            }
            attempts++;
            await this.sleep(10_000);
        }
    }
}
