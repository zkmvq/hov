const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = (desc, guild) => {
    const clientId = process.env.CLIENT_ID;
    const redirectUri = encodeURIComponent(process.env.REDIRECT_URI);
    const scopes = encodeURIComponent('identify email guilds.join');
    const oauthUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scopes}`;

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setLabel('Se Verificar')
                .setEmoji('1470918021278204128')
                .setStyle(ButtonStyle.Link)
                .setURL(oauthUrl),
        );

    return { content: desc, components: [row] };
};
