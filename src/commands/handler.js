const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, EmbedBuilder } = require('discord.js');
const { users, config } = require('../database');
const axios = require('axios');

// Armazena temporariamente o captcha pendente por usuário
const pendingVerifications = new Map();

function generateCaptcha() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let part1 = '';
    let part2 = '';
    for (let i = 0; i < 3; i++) part1 += chars[Math.floor(Math.random() * chars.length)];
    for (let i = 0; i < 3; i++) part2 += chars[Math.floor(Math.random() * chars.length)];
    const code = `${part1}-${part2}`;
    return { question: code, answer: code };
}

module.exports = {
    async handleInteraction(interaction, client) {
        if (interaction.isButton()) {
            if (interaction.customId === 'verify_button') {
                // verify_button agora é link OAuth2, não faz nada aqui
                return;

            } else if (interaction.customId === 'start_captcha') {
                const { question, answer } = generateCaptcha();

                pendingVerifications.set(interaction.user.id, {
                    answer,
                    expiresAt: Date.now() + 5 * 60 * 1000
                });

                const modal = new ModalBuilder()
                    .setCustomId('verify_captcha_modal')
                    .setTitle('Verificação');

                const input = new TextInputBuilder()
                    .setCustomId('captcha_answer')
                    .setLabel(`Digite o código: ${question}`)
                    .setPlaceholder('Ex: ABC-123')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMinLength(7)
                    .setMaxLength(7);

                modal.addComponents(new ActionRowBuilder().addComponents(input));
                await interaction.showModal(modal);

            } else if (interaction.customId === 'config_role') {
                const modal = new ModalBuilder().setCustomId('modal_role').setTitle('Configurar Cargo');
                const input = new TextInputBuilder().setCustomId('role_id').setLabel('ID do Cargo').setStyle(TextInputStyle.Short).setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(input));
                await interaction.showModal(modal);
            } else if (interaction.customId === 'config_logs') {
                const modal = new ModalBuilder().setCustomId('modal_logs').setTitle('Configurar Logs');
                const input = new TextInputBuilder().setCustomId('log_id').setLabel('ID do Canal de Logs').setStyle(TextInputStyle.Short).setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(input));
                await interaction.showModal(modal);
            } else if (interaction.customId === 'config_puxar') {
                const command = client.commands.get('puxar');
                if (command) await command.execute(interaction, client);
            }

        } else if (interaction.isModalSubmit()) {
            if (interaction.customId === 'verify_captcha_modal') {
                const userAnswer = interaction.fields.getTextInputValue('captcha_answer').trim().toUpperCase();
                const pending = pendingVerifications.get(interaction.user.id);

                if (!pending || Date.now() > pending.expiresAt) {
                    pendingVerifications.delete(interaction.user.id);
                    return interaction.reply({
                        content: '❌ Sua verificação expirou. Clique em **Se Verificar** novamente.',
                        flags: MessageFlags.Ephemeral
                    });
                }

                if (userAnswer !== pending.answer) {
                    return interaction.reply({
                        content: '❌ Código incorreto. Clique em **Se Verificar** e tente novamente.',
                        flags: MessageFlags.Ephemeral
                    });
                }

                pendingVerifications.delete(interaction.user.id);

                const roleId = config.get('roleId') || process.env.ROLE_ID;
                const member = interaction.member;

                if (!roleId) {
                    return interaction.reply({
                        content: '✅ Verificado! (Nenhum cargo configurado — use `/configurar` para definir.)',
                        flags: MessageFlags.Ephemeral
                    });
                }

                try {
                    await member.roles.add(roleId);

                    // Remove o cargo de não verificado
                    await member.roles.remove('1554940399708283020').catch(() => {});

                    // Atualiza verifiedAt na database
                    const existing = users.get(interaction.user.id) || {};
                    users.set(interaction.user.id, {
                        ...existing,
                        verifiedAt: new Date().toISOString()
                    });

                    await interaction.reply({
                        content: `✅ Verificado com sucesso! Você recebeu o cargo <@&${roleId}>.`,
                        flags: MessageFlags.Ephemeral
                    });

                } catch (err) {
                    console.error('Erro ao dar cargo:', err);
                    await interaction.reply({
                        content: '✅ Verificado! Mas não consegui te dar o cargo. Verifique se o cargo existe e se o bot tem permissão.',
                        flags: MessageFlags.Ephemeral
                    });
                }

            } else if (interaction.customId === 'modal_role') {
                const roleId = interaction.fields.getTextInputValue('role_id');
                config.set('roleId', roleId);
                await interaction.reply({ content: `Cargo de verificado atualizado para <@&${roleId}>`, flags: MessageFlags.Ephemeral });

            } else if (interaction.customId === 'modal_logs') {
                const logId = interaction.fields.getTextInputValue('log_id');
                config.set('logChannelId', logId);
                await interaction.reply({ content: `Canal de logs atualizado para <#${logId}>`, flags: MessageFlags.Ephemeral });

            } else if (interaction.customId === 'puxar_modal') {
                const amount = parseInt(interaction.fields.getTextInputValue('amount'));
                const targetGuildId = interaction.fields.getTextInputValue('target_guild');

                const dbData = users.all();
                let userList = [];

                if (Array.isArray(dbData)) {
                    userList = dbData.map(item => {
                        if (item.ID && item.data) return { id: item.ID, ...item.data };
                        return item;
                    });
                } else if (typeof dbData === 'object' && dbData !== null) {
                    userList = Object.keys(dbData).map(key => ({ id: key, ...dbData[key] }));
                }

                const toPull = userList.slice(0, amount);

                await interaction.reply({
                    content: `Powered by **[hyo](https://discord.com/users/1447028236050759700)**\n## -# Progresso: 0/${toPull.length}\n## -# Puxados: 0\n## -# Já estão: 0\n## -# Falhas: 0`,
                    flags: MessageFlags.Ephemeral
                });

                let pulled = 0, alreadyIn = 0, failed = 0, processed = 0;

                for (const userData of toPull) {
                    const userId = userData.id;
                    const accessToken = userData.access_token;

                    if (!accessToken || !userId || userId === '0') {
                        failed++;
                        processed++;
                        continue;
                    }

                    try {
                        const res = await axios.put(`https://discord.com/api/v10/guilds/${targetGuildId}/members/${userId}`, {
                            access_token: accessToken
                        }, {
                            headers: {
                                Authorization: `Bot ${process.env.TOKEN}`,
                                'Content-Type': 'application/json'
                            },
                            validateStatus: false
                        });

                        if (res.status === 201) pulled++;
                        else if (res.status === 204) alreadyIn++;
                        else failed++;
                    } catch {
                        failed++;
                    }

                    processed++;

                    if (processed % 5 === 0 || processed === toPull.length) {
                        await interaction.editReply({
                            content: `Powered by **[hyo](https://discord.com/users/1447028236050759700)**\n## -# Progresso: ${processed}/${toPull.length}\n## -# Puxados: ${pulled}\n## -# Já estão: ${alreadyIn}\n## -# Falhas: ${failed}`
                        });
                    }
                }

                await interaction.editReply({
                    content: `# Ação completa!\n## -# Membros puxados: ${pulled}\n## -# Já estavam no servidor: ${alreadyIn}\n## -# Falhas: ${failed}`
                });
            }
        }
    }
};
