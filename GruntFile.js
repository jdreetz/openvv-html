module.exports = function(grunt) {
  grunt.initConfig({
    browserify:{
      dist:{
        files:{
          'dist/openvv.js':['src/OpenVV.js']
        },
        options:{
          transform:['babelify'],
          browserifyOptions:{
            debug:true,
            standalone:'OpenVV'
          }
        }
      }
    }
  });

  grunt.loadNpmTasks('grunt-browserify');
  grunt.registerTask('default',['browserify:dist']);
  grunt.registerTask('test',[]);
}