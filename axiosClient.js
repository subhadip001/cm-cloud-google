const axios = require('axios');

const axiosClient = axios.create({
    baseURL: 'https://cm.subhadipmandal.engineer/cm',
    withCredentials: true,
});

module.exports = axiosClient;