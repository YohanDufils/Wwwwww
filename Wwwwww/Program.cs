var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    WebRootPath = "."
});
var app = builder.Build();
app.UseDefaultFiles(new DefaultFilesOptions
{
    DefaultFileNames = new[] { "WWWWWW.html" }
});
app.UseStaticFiles();
app.Run();
