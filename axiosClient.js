const axios = require('axios');

const axiosClient = axios.create({
    baseURL: 'https://nb6y2cwyo7.execute-api.ap-south-1.amazonaws.com/prod/femto',
    withCredentials: false,
});

module.exports = axiosClient;