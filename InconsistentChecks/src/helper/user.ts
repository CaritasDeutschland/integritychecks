import hibase32 from 'hi-base32';

export const decodeUsername = (username: string = '') => {
    return username.split('.')?.[0] === 'enc'
        ? hibase32.decode(username.split('.')[1].toUpperCase() + '=')
        : username;
};